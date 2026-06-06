import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// 4everland S3-compatible IPFS storage
// Credentials come from server-side env vars — never exposed to the browser
const s3 = new S3Client({
  endpoint: "https://endpoint.4everland.co",
  region: "us-west-2", // required by SDK but unused by 4everland
  credentials: {
    accessKeyId: process.env.EVERLAND_ACCESS_KEY!,
    secretAccessKey: process.env.EVERLAND_SECRET_KEY!,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.EVERLAND_BUCKET!;

export async function POST(req: NextRequest) {
  // Check env vars are configured
  if (!process.env.EVERLAND_ACCESS_KEY || !process.env.EVERLAND_SECRET_KEY || !BUCKET) {
    return NextResponse.json(
      { error: "IPFS storage not configured. Set EVERLAND_ACCESS_KEY, EVERLAND_SECRET_KEY, EVERLAND_BUCKET in .env.local" },
      { status: 503 }
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate type — accept images only
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only image files are accepted" }, { status: 400 });
    }

    // Max 50 MB
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 50 MB)" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Use a timestamp+random key to avoid collisions
    const ext = file.name.split(".").pop() || "bin";
    const key = `ed4ns/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: file.type,
      // Make object publicly readable
      ACL: "public-read",
    });

    const result = await s3.send(cmd);

    // 4everland returns the IPFS CID in the ETag header, enclosed in quotes.
    const cid = result.ETag ? result.ETag.replace(/"/g, "") : "";

    // Standard IPFS URI format
    const ipfsUrl = `ipfs://${cid}`;
    
    // Dedicated 4everland IPFS gateway URL (fastest and most reliable since they host it)
    const gatewayUrl = `https://${cid}.ipfs.4everland.io/`;

    return NextResponse.json({
      ipfsUrl,
      gatewayUrl,
      cid,
      key,
    });
  } catch (err: any) {
    console.error("[4everland upload error]", err);
    return NextResponse.json(
      { error: err.message || "Upload failed" },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 30;
