import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface FrontendStackProps extends cdk.StackProps {
  /** DNS name of the CodeCollab ALB — origin for /api/*, /ws/*, /translate/*. */
  albDnsName: string;
  /** Full custom domain (e.g. codecollab.example.com). All three domain vars
   *  must be supplied together; if any is absent the stack deploys with the
   *  CloudFront default *.cloudfront.net domain only. */
  domainName?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly siteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);
    const { albDnsName, domainName, hostedZoneId, hostedZoneName } = props;

    // ── S3 bucket for compiled SPA assets ────────────────────────────────────
    this.siteBucket = new s3.Bucket(this, "SiteBucket", {
      bucketName: `codecollab-frontend-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
    });

    // ── ALB origin for dynamic paths ──────────────────────────────────────────
    //
    // CloudFront natively supports WebSocket upgrades for the /ws/* behavior.
    // CACHING_DISABLED + ALL_VIEWER_EXCEPT_HOST_HEADER ensures that connection
    // upgrade headers are forwarded and responses are never cached.
    const albOrigin = new origins.HttpOrigin(albDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
    });

    const albBehavior: cloudfront.BehaviorOptions = {
      origin: albOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy:
        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    };

    // ── Optional ACM cert + hosted zone (all three context vars required) ─────
    const hasDomain = !!(domainName && hostedZoneId && hostedZoneName);
    let certificate: acm.ICertificate | undefined;
    let domainNames: string[] | undefined;
    let hostedZone: route53.IHostedZone | undefined;

    if (hasDomain) {
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        "HostedZone",
        { hostedZoneId: hostedZoneId!, zoneName: hostedZoneName! }
      );
      // ACM certificates for CloudFront must live in us-east-1.
      certificate = new acm.Certificate(this, "Certificate", {
        domainName: domainName!,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
      domainNames = [domainName!];
    }

    // ── CloudFront distribution ───────────────────────────────────────────────
    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "CodeCollab SPA CDN",
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        compress: true,
      },
      additionalBehaviors: {
        // /api/* covers sessions, run, and translate (all backed by ALB).
        "/api/*": albBehavior,
        "/ws/*": albBehavior,
      },
      // SPA fallback: S3 with OAC + BlockPublicAccess returns 403 (not 404)
      // for unknown paths, so we only need the 403 mapping. Mapping 404 here
      // would clobber legitimate API 404s served from the ALB origin
      // (e.g., GET /api/sessions/<unknown> → collab-server 404 → frontend
      // SessionNotFoundView).
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
      ],
      certificate,
      domainNames,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: true,
    });

    // ── Route 53 A + AAAA alias records ──────────────────────────────────────
    if (hasDomain && hostedZone) {
      const cfTarget = route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(this.distribution)
      );
      new route53.ARecord(this, "AliasRecord", {
        zone: hostedZone,
        recordName: domainName!,
        target: cfTarget,
      });
      new route53.AaaaRecord(this, "AliasAaaaRecord", {
        zone: hostedZone,
        recordName: domainName!,
        target: cfTarget,
      });
    }

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: this.distribution.distributionId,
      exportName: "CodeCollab-DistributionId",
    });

    new cdk.CfnOutput(this, "CloudFrontDomainName", {
      value: this.distribution.distributionDomainName,
      exportName: "CodeCollab-CloudFrontDomain",
    });

    new cdk.CfnOutput(this, "PublicDomain", {
      value: hasDomain
        ? `https://${domainName}`
        : `https://${this.distribution.distributionDomainName}`,
      exportName: "CodeCollab-PublicUrl",
    });

    new cdk.CfnOutput(this, "SiteBucketName", {
      value: this.siteBucket.bucketName,
      exportName: "CodeCollab-FrontendBucketName",
      description:
        "Upload SPA: aws s3 sync ./build s3://<bucket> --delete && aws cloudfront create-invalidation --distribution-id <ID> --paths '/*'",
    });
  }
}
