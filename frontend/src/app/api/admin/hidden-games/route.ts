import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "src/hidden-games.json");

export async function GET() {
  try {
    const data = await fs.readFile(DATA_FILE, "utf8");
    const hiddenGames = JSON.parse(data);
    return NextResponse.json(hiddenGames);
  } catch (error) {
    // If file doesn't exist or fails, return empty array
    return NextResponse.json([]);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
    }
    await fs.writeFile(DATA_FILE, JSON.stringify(body, null, 2), "utf8");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to write data" }, { status: 500 });
  }
}
