import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as path from "path";
import { Construct } from "constructs";

export interface RendererConstructProps {
  bucket: s3.Bucket;
}

export class RendererConstruct extends Construct {
  public readonly rendererHandler: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: RendererConstructProps) {
    super(scope, id);

    this.rendererHandler = new nodejs.NodejsFunction(this, "RendererHandler", {
      functionName: "homework-bot-renderer",
      entry: path.join(__dirname, "../../../functions/src/renderer/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 2048,
      environment: {
        BUCKET_NAME: props.bucket.bucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant S3 read/write permissions
    props.bucket.grantReadWrite(this.rendererHandler);

    // Add S3 event notification for .html files in prints/ prefix
    props.bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.rendererHandler),
      { prefix: "prints/", suffix: ".html" }
    );
  }
}
