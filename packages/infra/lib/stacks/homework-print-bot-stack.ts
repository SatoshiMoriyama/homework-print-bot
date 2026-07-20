import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DynamoDbConstruct } from "../constructs/dynamodb";
import { S3Construct } from "../constructs/s3";
import { ApiConstruct } from "../constructs/api";
import { MonitoringConstruct } from "../constructs/monitoring";

export class HomeworkPrintBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dynamodb = new DynamoDbConstruct(this, "DynamoDB");
    const s3 = new S3Construct(this, "S3");
    const api = new ApiConstruct(this, "Api", {
      tables: dynamodb.tables,
      bucket: s3.bucket,
    });
    new MonitoringConstruct(this, "Monitoring", {
      webhookHandler: api.webhookHandler,
    });
  }
}
