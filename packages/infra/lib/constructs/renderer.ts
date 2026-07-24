import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as path from "path";
import { Construct } from "constructs";

export interface RendererConstructProps {
  bucket: s3.Bucket;
}

export class RendererConstruct extends Construct {
  public readonly rendererFunction: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: RendererConstructProps) {
    super(scope, id);

    this.rendererFunction = new nodejs.NodejsFunction(this, "HtmlToPngRenderer", {
      functionName: "homework-bot-html-to-png-renderer",
      entry: path.join(__dirname, "../../../functions/src/renderer/index.ts"),
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
        nodeModules: ["@sparticuz/chromium", "puppeteer-core"],
      },
    });

    // Grant S3 read/write to the renderer
    props.bucket.grantReadWrite(this.rendererFunction);
  }
}
