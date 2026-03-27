import { NextResponse } from "next/server";

/** 显式声明 UTF-8，避免部分浏览器把 JSON 当 Latin-1 显示成乱码 */
export function jsonUtf8(data: unknown, init?: { status?: number }) {
  return new NextResponse(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
