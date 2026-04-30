import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

/**
 * NetworkStack provisions the VPC, subnets, NAT gateways, and VPC endpoints
 * shared by all other CodeCollab stacks. Other stacks import the VPC and
 * subnet references via CloudFormation exports.
 */
export class NetworkStack extends cdk.Stack {
  /** The VPC shared across all CodeCollab stacks. */
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "CodeCollabVpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      maxAzs: 2,
      natGateways: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Gateway endpoints — free, route-table-based
    this.vpc.addGatewayEndpoint("DynamoDbEndpoint", {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    this.vpc.addGatewayEndpoint("S3Endpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    const privateSubnets = this.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    });

    const endpointSg = new ec2.SecurityGroup(this, "VpcEndpointSg", {
      vpc: this.vpc,
      description: "Allow HTTPS from within VPC to interface endpoints",
      allowAllOutbound: false,
    });
    endpointSg.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      "HTTPS from VPC CIDR"
    );

    // Interface endpoints — keep ECR and CloudWatch Logs traffic inside the VPC
    this.vpc.addInterfaceEndpoint("EcrApiEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      subnets: privateSubnets,
      securityGroups: [endpointSg],
      privateDnsEnabled: true,
    });

    this.vpc.addInterfaceEndpoint("EcrDkrEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      subnets: privateSubnets,
      securityGroups: [endpointSg],
      privateDnsEnabled: true,
    });

    this.vpc.addInterfaceEndpoint("CloudWatchLogsEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: privateSubnets,
      securityGroups: [endpointSg],
      privateDnsEnabled: true,
    });

    // CloudFormation exports consumed by DataStack and ComputeStack
    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      exportName: "CodeCollab-VpcId",
    });

    new cdk.CfnOutput(this, "PrivateSubnetIds", {
      value: this.vpc.privateSubnets.map((s) => s.subnetId).join(","),
      exportName: "CodeCollab-PrivateSubnetIds",
    });

    new cdk.CfnOutput(this, "PublicSubnetIds", {
      value: this.vpc.publicSubnets.map((s) => s.subnetId).join(","),
      exportName: "CodeCollab-PublicSubnetIds",
    });
  }
}
