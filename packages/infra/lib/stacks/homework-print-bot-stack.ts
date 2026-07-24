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
    const api = new ApiConstruct(this, "Api", {
      tables: dynamodb.tables,
      bucket: s3.bucket,
    });
    const renderer = new RendererConstruct(this, "Renderer", {
      bucket: s3.bucket,
    });

    // Grant webhook handler permission to invoke the renderer Lambda
    renderer.rendererFunction.grantInvoke(api.webhookHandler);
    // Pass renderer function name as environment variable to webhook handler
    api.webhookHandler.addEnvironment("RENDERER_FUNCTION_NAME", renderer.rendererFunction.functionName);

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
