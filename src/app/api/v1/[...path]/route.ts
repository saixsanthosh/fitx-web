import { NextResponse } from "next/server";

function retired() {
  return NextResponse.json({ error: "This API is no longer available." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}

export const GET = retired;
export const POST = retired;
export const PUT = retired;
export const PATCH = retired;
export const DELETE = retired;
