// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

it("취득 방법 추가 시 기존 구매 기록과 금액을 보존하고 허용값을 제한한다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql") && name < "0005").sort()) db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec("INSERT INTO wishes (id,title,url,status,purchased,purchase_price,purchased_at) VALUES ('old','기존 항목','https://example.com','purchased',1,42000,'2026-10-01')");
    db.exec(readFileSync("migrations/0005_purchase_method.sql", "utf8"));
    const row = db.prepare("SELECT purchase_method,purchase_price,purchased_at FROM wishes WHERE id='old'").get();
    expect({ ...row }).toEqual({ purchase_method: "unknown", purchase_price: 42000, purchased_at: "2026-10-01" });
    expect(() => db.exec("UPDATE wishes SET purchase_method='invalid'")).toThrow();
    db.exec("UPDATE wishes SET purchase_method='gift'");
    expect(db.prepare("SELECT purchase_price FROM wishes").get()?.purchase_price).toBe(42000);
    // Prepare production SQL against the migrated schema to catch column/placeholder mismatches.
    const source = readFileSync("worker/index.ts", "utf8");
    const statements = [...source.matchAll(/(?:prepare\(`)([\s\S]*?)(?:`\))/g)].map((match) => match[1]);
    for (const sql of statements.filter((sql) => sql.includes("purchase_method") && !sql.includes("${"))) db.prepare(sql);
  } finally { db.close(); }
});
