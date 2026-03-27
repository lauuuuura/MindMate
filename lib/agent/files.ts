import fs from "node:fs";
import path from "node:path";

function readFirstExisting(paths: string[]) {
  for (const p of paths) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  }
  return "";
}

export function loadRolePrompt() {
  return readFirstExisting([
    path.join(process.cwd(), "data/agent/角色.md"),
    path.join(process.cwd(), "角色.md")
  ]);
}

export function loadStageDocs() {
  return {
    探索: readFirstExisting([
      path.join(process.cwd(), "data/agent/探索阶段-md.md"),
      path.join(process.cwd(), "探索阶段-md.md")
    ]),
    领悟: readFirstExisting([
      path.join(process.cwd(), "data/agent/领悟阶段-md.md"),
      path.join(process.cwd(), "领悟阶段-md.md")
    ]),
    行动: readFirstExisting([
      path.join(process.cwd(), "data/agent/行动阶段-md.md"),
      path.join(process.cwd(), "行动阶段-md.md")
    ])
  };
}
