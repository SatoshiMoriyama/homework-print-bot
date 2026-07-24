import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DynamoDbConstruct } from "../constructs/dynamodb";
import { S3Construct } from "../constructs/s3";
import { ApiConstruct } from "../constructs/api";
import { AgentCoreConstruct } from "../constructs/agentcore";
import { MonitoringConstruct } from "../constructs/monitoring";
import { RendererConstruct } from "../constructs/renderer";

export class HomeworkPrintBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dynamodb = new DynamoDbConstruct(this, "DynamoDB");
    const s3 = new S3Construct(this, "S3");
    new RendererConstruct(this, "Renderer", {
      bucket: s3.bucket,
    });
    const api = new ApiConstruct(this, "Api", {
      tables: dynamodb.tables,
      bucket: s3.bucket,
    });
    new AgentCoreConstruct(this, "AgentCore", {
      tables: dynamodb.tables,
      bucket: s3.bucket,
      webhookHandler: api.webhookHandler,
    });
    new MonitoringConstruct(this, "Monitoring", {
      webhookHandler: api.webhookHandler,
    });
  }
}
