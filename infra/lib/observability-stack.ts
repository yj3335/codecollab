import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";
import { ComputeStack } from "./compute-stack";
import { DataStack } from "./data-stack";

export interface ObservabilityStackProps extends cdk.StackProps {
  dataStack: DataStack;
  computeStack: ComputeStack;
}

/**
 * Deploys a CloudWatch dashboard with the four core CodeCollab signals:
 * active WebSocket connections, code-execution P95 latency, translation
 * Lambda latency/errors, and DynamoDB write latency.
 */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { dataStack, computeStack } = props;

    const clusterName = computeStack.cluster.clusterName;
    const fnName = dataStack.translationFn.functionName;
    const tableName = dataStack.sessionsTable.tableName;
    const period = cdk.Duration.minutes(5);

    // ── Widget 1: Active WebSocket Connections ────────────────────────────────
    // Primary: custom "ActiveConnections" metric emitted by collab-server.
    // Right axis fallback: ECS RunningTaskCount is a proxy until Person B ships
    // the custom metric from collab-server's room-manager.
    const activeConnectionsWidget = new cloudwatch.GraphWidget({
      title: "Active WebSocket Connections",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "CodeCollab/CollabServer",
          metricName: "ActiveConnections",
          dimensionsMap: { ClusterName: clusterName },
          statistic: "Average",
          period,
          label: "ActiveConnections (custom)",
        }),
      ],
      right: [
        // TODO(Person B): remove once collab-server emits ActiveConnections metric
        new cloudwatch.Metric({
          namespace: "AWS/ECS",
          metricName: "RunningTaskCount",
          dimensionsMap: {
            ClusterName: clusterName,
            ServiceName: computeStack.collabServiceName,
          },
          statistic: "Average",
          period,
          label: "RunningTaskCount (fallback)",
        }),
      ],
    });

    // ── Widget 2: Code Execution P95 Latency ─────────────────────────────────
    // Primary: custom "ExecutionDurationMs" metric emitted by execution-api.
    // Right axis fallback: ALB TargetResponseTime across the whole load balancer
    // until Person C ships the custom metric.
    const executionLatencyWidget = new cloudwatch.GraphWidget({
      title: "Execution P95 Latency",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "CodeCollab/ExecutionAPI",
          metricName: "ExecutionDurationMs",
          dimensionsMap: { ClusterName: clusterName },
          statistic: "p95",
          period,
          label: "ExecutionDurationMs p95 (custom)",
        }),
      ],
      right: [
        // TODO(Person C): remove once execution-api emits ExecutionDurationMs metric
        new cloudwatch.Metric({
          namespace: "AWS/ApplicationELB",
          metricName: "TargetResponseTime",
          dimensionsMap: { LoadBalancer: computeStack.albFullName },
          statistic: "p95",
          period,
          label: "ALB TargetResponseTime p95 (fallback)",
        }),
      ],
    });

    // ── Widget 3: Translation Lambda Latency + Errors + Throttles ────────────
    const translationWidget = new cloudwatch.GraphWidget({
      title: "Translation Lambda",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/Lambda",
          metricName: "Duration",
          dimensionsMap: { FunctionName: fnName },
          statistic: "p95",
          period,
          label: "Duration p95 (ms)",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/Lambda",
          metricName: "Errors",
          dimensionsMap: { FunctionName: fnName },
          statistic: "Sum",
          period,
          label: "Errors",
        }),
        new cloudwatch.Metric({
          namespace: "AWS/Lambda",
          metricName: "Throttles",
          dimensionsMap: { FunctionName: fnName },
          statistic: "Sum",
          period,
          label: "Throttles",
        }),
      ],
    });

    // ── Widget 4: DynamoDB Write Latency + Consumed Capacity ─────────────────
    const dynamoWidget = new cloudwatch.GraphWidget({
      title: "DynamoDB Write Latency (sessions)",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "SuccessfulRequestLatency",
          dimensionsMap: { TableName: tableName, Operation: "PutItem" },
          statistic: "Average",
          period,
          label: "PutItem Average (ms)",
        }),
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "SuccessfulRequestLatency",
          dimensionsMap: { TableName: tableName, Operation: "PutItem" },
          statistic: "p95",
          period,
          label: "PutItem p95 (ms)",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "ConsumedWriteCapacityUnits",
          dimensionsMap: { TableName: tableName },
          statistic: "Sum",
          period,
          label: "ConsumedWriteCapacityUnits",
        }),
      ],
    });

    // ── Dashboard: 2×2 grid, each widget 12 wide × 6 high ────────────────────
    const dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: "codecollab-dashboard",
    });
    dashboard.addWidgets(activeConnectionsWidget, executionLatencyWidget);
    dashboard.addWidgets(translationWidget, dynamoWidget);

    new cdk.CfnOutput(this, "DashboardUrl", {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=codecollab-dashboard`,
      exportName: "CodeCollab-DashboardUrl",
    });
  }
}
