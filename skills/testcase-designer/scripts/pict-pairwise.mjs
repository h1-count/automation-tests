#!/usr/bin/env node
// pict-pairwise.mjs —— 零依赖成对组合（pairwise / 2-way）测试数据生成器。
// 配套文档：skills/testcase-designer/references/pairwise-design.md
//
// 用法：
//   node skills/testcase-designer/scripts/pict-pairwise.mjs --model <model.json> [--format md|json]
//
// 模型 JSON：
//   {
//     "parameters": { "参数名": ["取值", ...], ... },        // 保序，决定输出列顺序
//     "exclude": [ ["A=a", "B=b"], ... ],                   // 行内同时含全部原子 => 剔除
//     "ifThen": [ { "if": "A=a", "then": "B=b1,b2" } ]      // IF A=a THEN B 仅允许列出的取值
//   }

import fs from "node:fs/promises";

const MAX_COMBOS = 200_000;

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseAtom(atom) {
  const eq = String(atom).indexOf("=");
  if (eq <= 0 || eq === String(atom).length - 1) {
    throw new Error(`非法约束原子：${atom}（应为 参数=值）`);
  }
  return [String(atom).slice(0, eq), String(atom).slice(eq + 1)];
}

const args = process.argv.slice(2);
const modelPath = option(args, "--model");
const format = option(args, "--format") ?? "md";
if (!modelPath || !["md", "json"].includes(format)) {
  console.error("用法：node pict-pairwise.mjs --model <model.json> [--format md|json]");
  process.exit(1);
}

const model = JSON.parse(await fs.readFile(modelPath, "utf8"));
const parameters = model.parameters;
if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
  throw new Error("模型缺少 parameters 对象。");
}
const paramNames = Object.keys(parameters);
if (paramNames.length === 0) throw new Error("parameters 不能为空。");
for (const name of paramNames) {
  const values = parameters[name];
  if (!Array.isArray(values) || values.length === 0) throw new Error(`参数 ${name} 的取值必须是非空数组。`);
  if (new Set(values).size !== values.length) throw new Error(`参数 ${name} 存在重复取值。`);
}

// ---- 约束编译：统一为“禁止原子组”列表 ----
const forbidden = [];
for (const entry of model.exclude ?? []) {
  const atoms = (Array.isArray(entry) ? entry : [entry]).map(parseAtom);
  if (atoms.length === 0) throw new Error("exclude 存在空条目。");
  forbidden.push(atoms);
}
for (const rule of model.ifThen ?? []) {
  const [ifParam, ifValue] = parseAtom(rule.if);
  const allowed = String(rule.then).split(",").map((item) => item.trim()).map(parseAtom);
  const thenParams = [...new Set(allowed.map(([p]) => p))];
  if (thenParams.length !== 1) throw new Error(`ifThen 的 then 只支持单参数：${JSON.stringify(rule)}`);
  const thenParam = thenParams[0];
  if (thenParam === ifParam) throw new Error(`ifThen 不支持同参数约束：${JSON.stringify(rule)}`);
  const allowedValues = allowed.map(([, v]) => v);
  const unknown = allowedValues.filter((v) => !parameters[thenParam].includes(v));
  if (unknown.length > 0) throw new Error(`ifThen 引用了不存在的取值：${thenParam}=${unknown.join(",")}`);
  for (const value of parameters[thenParam]) {
    if (!allowedValues.includes(value)) forbidden.push([[ifParam, ifValue], [thenParam, value]]);
  }
}
for (const tuple of forbidden) {
  for (const [param, value] of tuple) {
    if (!parameters[param]) throw new Error(`约束引用了不存在的参数：${param}`);
    if (!parameters[param].includes(value)) throw new Error(`约束引用了不存在的取值：${param}=${value}`);
  }
}

// ---- 全组合枚举（保序、带剔除与上限） ----
const totalCombos = paramNames.reduce((acc, name) => acc * parameters[name].length, 1);
if (totalCombos > MAX_COMBOS) {
  throw new Error(`全组合 ${totalCombos} 超过上限 ${MAX_COMBOS}：请先用等价类压缩取值，或拆分为多个独立模型。`);
}
const isForbidden = (row) => {
  const rowMap = new Map(row);
  return forbidden.some((tuple) => tuple.every(([p, v]) => rowMap.get(p) === v));
};
const validRows = [];
(function enumerate(index, current) {
  if (index === paramNames.length) {
    if (!isForbidden(current)) validRows.push([...current]);
    return;
  }
  for (const value of parameters[paramNames[index]]) {
    current.push([paramNames[index], value]);
    enumerate(index + 1, current);
    current.pop();
  }
})(0, []);
if (validRows.length === 0) throw new Error("约束剔除了所有组合，请检查 exclude / ifThen。");

// ---- 目标集：只统计有效行中真实出现的两两取值对（被约束整体排除的对属预期，另行提示） ----
const pairKey = (i, vi, j, vj) => `${paramNames[i]}=${vi}|${paramNames[j]}=${vj}`;
const allPairs = new Set();
if (paramNames.length === 1) {
  for (const value of parameters[paramNames[0]]) allPairs.add(`${paramNames[0]}=${value}`);
} else {
  for (let i = 0; i < paramNames.length; i += 1) {
    for (let j = i + 1; j < paramNames.length; j += 1) {
      for (const vi of parameters[paramNames[i]]) {
        for (const vj of parameters[paramNames[j]]) allPairs.add(pairKey(i, vi, j, vj));
      }
    }
  }
}
const rowTargets = (row) => {
  const keys = [];
  if (paramNames.length === 1) {
    keys.push(`${paramNames[0]}=${row[0][1]}`);
  } else {
    for (let i = 0; i < row.length; i += 1) {
      for (let j = i + 1; j < row.length; j += 1) {
        keys.push(pairKey(i, row[i][1], j, row[j][1]));
      }
    }
  }
  return keys;
};
const targets = new Set();
for (const row of validRows) for (const key of rowTargets(row)) targets.add(key);
const excludedByConstraints = [...allPairs].filter((key) => !targets.has(key));

// ---- 贪心选行：每轮取覆盖未覆盖目标最多的行（平手取枚举序最先，结果确定） ----
const chosen = [];
while (targets.size > 0) {
  let best = null;
  let bestGain = 0;
  for (const row of validRows) {
    let gain = 0;
    for (const key of rowTargets(row)) if (targets.has(key)) gain += 1;
    if (gain > bestGain) {
      bestGain = gain;
      best = row;
      if (gain === rowTargets(row).length && gain >= paramNames.length) break; // 单行已饱和，提前收
    }
  }
  if (!best) break; // 剩余目标无行可覆盖（被约束整体排除）
  chosen.push(best);
  for (const key of rowTargets(best)) targets.delete(key);
}
const uncoveredRemaining = [...targets];

// ---- 输出 ----
const toRowObject = (row) => Object.fromEntries(row);
const statistics = {
  parameters: paramNames.length,
  valuesPerParameter: Object.fromEntries(paramNames.map((n) => [n, parameters[n].length])),
  totalCombos,
  forbiddenRules: forbidden.length,
  validCombos: validRows.length,
  chosenRows: chosen.length,
  reductionPercent: Math.round((1 - chosen.length / validRows.length) * 1000) / 10,
  excludedByConstraints: excludedByConstraints.length,
  uncoveredRemaining: uncoveredRemaining.length,
};

if (format === "json") {
  console.log(JSON.stringify({
    model: modelPath,
    statistics,
    excludedByConstraints,
    uncoveredRemaining,
    rows: chosen.map(toRowObject),
  }, null, 2));
} else {
  const header = ["#", ...paramNames];
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  chosen.forEach((row, index) => {
    lines.push(`| D${String(index + 1).padStart(2, "0")} | ${row.map(([, v]) => v).join(" | ")} |`);
  });
  const stats = [
    `参数 ${statistics.parameters} 个；全组合 ${totalCombos}（剔除后有效 ${validRows.length}）；约束 ${forbidden.length} 条。`,
    `选中 ${chosen.length} 行（编号 D01~D${String(chosen.length).padStart(2, "0")}），压缩 ${statistics.reductionPercent}%。`,
    uncoveredRemaining.length > 0
      ? `告警：${uncoveredRemaining.length} 个可覆盖取值对未被覆盖（模型或算法异常）：\n  - ${uncoveredRemaining.join("\n  - ")}`
      : "覆盖校验：全部可覆盖取值对均已覆盖。",
  ];
  if (excludedByConstraints.length > 0) {
    stats.push(`被约束整体排除、不计入覆盖目标的取值对 ${excludedByConstraints.length} 个（属预期）：\n  - ${excludedByConstraints.join("\n  - ")}`);
  }
  console.log(`${lines.join("\n")}\n\n${stats.join("\n")}`);
  if (uncoveredRemaining.length > 0) process.exitCode = 2;
}
