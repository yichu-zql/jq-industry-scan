// Deterministic, reviewable subset; unsupported prose is never silently executed.
export function parseTagRule(text) {
  const raw = String(text || "").trim();
  if (!raw) return { mode: "all", include: [], exclude: [], text: "" };
  if (raw.length > 500) throw Error("打标描述请控制在500字以内");
  const s = raw
    .replace(/[“”「」"']/g, "")
    .replace(/关键词|词语/g, "")
    .replace(/词[。；;]?$/, "");
  const parts = s.split(/(?:但|并且|并)?(?:不包含|不含|排除)/);
  if (parts.length > 2) throw Error("请将排除词放在一个“不包含”之后");
  let head = parts[0].replace(/[，,；;\s]+$/, "").trim();
  const mode = /任一|任意|或者|或/.test(head) ? "any" : "all";
  if (!/^(?:同时|全部|任一|任意)?包含/.test(head) && head !== "")
    throw Error("请使用“同时包含…，但不包含…”或“任一包含…”");
  head = head.replace(/^(?:同时|全部|任一|任意)?包含\s*/, "");
  const tokens = (v) => [
    ...new Set(
      v
        .split(/[、,，;；\n]+|\s+(?:和|且|或)\s+|以及|并且|或者|或/)
        .map((t) => t.trim().replace(/[。\s]+$/, ""))
        .filter(Boolean),
    ),
  ];
  const include = tokens(head),
    exclude = tokens(parts[1] || "");
  if (
    [...include, ...exclude].some((v) =>
      /包含|不含|排除|但是|至少|大于|小于/.test(v),
    )
  )
    throw Error("无法明确拆分，请改用逗号分隔包含词和排除词");
  if (!include.length && !exclude.length)
    throw Error("请填写需要包含或排除的词");
  if (include.some((v) => exclude.includes(v)))
    throw Error("同一个词不能同时包含和排除");
  return { text: raw, mode, include, exclude };
}
export function describeRule(r) {
  return !r.include.length && !r.exclude.length
    ? "不使用商品打标规则"
    : `${r.include.length ? (r.mode === "all" ? "同时包含" : "任一包含") + "「" + r.include.join("、") + "」" : ""}${r.exclude.length ? "；不含「" + r.exclude.join("、") + "」" : ""}`;
}
export function mountRules(host, state, changed) {
  host.innerHTML =
    '<label class="rule-input">自定义类目打标词<textarea id="tag-description" rows="2" maxlength="500" placeholder="例如：同时包含吹风机、红光，但不包含配件"></textarea></label><div class="toolbar"><strong>系统拆分打标词核对：</strong><span id="tag-preview"></span><button id="tag-confirm">确认规则</button><button id="tag-clear">清除规则</button></div><p class="note" id="tag-status" role="status"></p>';
  const $ = (id) => host.querySelector("#" + id);
  let parsed = null;
  function preview() {
    try {
      parsed = parseTagRule(state.ruleDraft);
      $("tag-preview").textContent = describeRule(parsed);
      $("tag-confirm").disabled = false;
    } catch (e) {
      parsed = null;
      $("tag-preview").textContent = e.message;
      $("tag-confirm").disabled = true;
    }
  }
  function refresh() {
    state.ruleDraft = state.ruleDraft || "";
    $("tag-description").value = state.ruleDraft;
    preview();
    $("tag-status").textContent =
      state.ruleDraft !== (state.confirmedRule?.text || "")
        ? "待确认，修改尚未生效"
        : state.confirmedRule?.text
          ? "规则已确认，生成速览时按商品名称筛选"
          : "填写后核对并确认";
  }
  $("tag-description").oninput = () => {
    state.ruleDraft = $("tag-description").value;
    preview();
    $("tag-status").textContent = "待确认，修改尚未生效";
    changed();
  };
  $("tag-confirm").onclick = () => {
    if (!parsed) return;
    state.confirmedRule = { ...parsed };
    changed();
    refresh();
  };
  $("tag-clear").onclick = () => {
    state.ruleDraft = "";
    state.confirmedRule = null;
    changed();
    refresh();
  };
  refresh();
  return refresh;
}
