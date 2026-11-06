import { esc } from "./trend-chart.js?v=2.5.0";
const KEY = "jq-custom-industries-v1";
export function normalizeScheme(value, categories) {
  if (
    value?.version !== 1 ||
    !Array.isArray(value.ids) ||
    !value.ids.length ||
    typeof value.name !== "string" ||
    !value.name.trim()
  )
    throw Error("方案格式无效");
  const allowed = new Set(categories.map((c) => c.id));
  if (value.ids.some((id) => !allowed.has(id)))
    throw Error("方案包含当前数据中不存在的类目");
  return {
    version: 1,
    name: value.name.trim().slice(0, 80),
    ids: [...new Set(value.ids)],
  };
}
export function mountSelection(host, cats, state, onChange, download) {
  const $ = (id) => host.querySelector("#" + id);
  let draft = new Set(state.ids),
    schemes = [];
  try {
    schemes = JSON.parse(window.localStorage.getItem(KEY) || "[]").map((v) =>
      normalizeScheme(v, cats),
    );
  } catch {
    schemes = [];
  }
  const message = (t) => {
    $("scheme-status").textContent = t;
  };
  host.innerHTML = `<div class="toolbar"><label>行业名称 <input id="industry-name" maxlength="80" placeholder="例如：头发护理行业" value="${esc(state.name || "")}"></label><label>本机方案 <select id="scheme-list"><option value="">选择已保存方案</option></select></label><button id="scheme-save">保存方案</button><button id="scheme-export">导出方案</button><button id="scheme-import">导入方案</button><input type="file" id="scheme-file" accept=".json" hidden><span id="scheme-status" role="status"></span></div><div class="section-head"><strong id="selection-count"></strong><button id="selection-edit">调整类目</button></div><div id="selection-tags" class="selection-tags"></div><p class="note">按所选类目组合分析 · 方案保存在本机</p><div id="selection-dialog" class="selection-overlay" hidden><section role="dialog" aria-modal="true" aria-labelledby="selection-heading" class="selection-dialog"><h3 id="selection-heading">调整类目范围</h3><div class="toolbar"><label>一级类目 <select id="selection-root"><option value="">全部一级</option>${[...new Set(cats.map((c) => c.path[0]))].map((v) => `<option>${esc(v)}</option>`).join("")}</select></label><label>二级类目 <select id="selection-second"></select></label><input id="selection-search" type="search" aria-label="搜索类目" placeholder="搜索类目"></div><div class="selection-columns"><div><div class="toolbar"><button id="selection-add"></button><button id="selection-remove">取消当前结果</button></div><div id="selection-options"></div></div><aside><strong id="draft-count"></strong><button id="selection-clear">清空已选</button><div id="selection-draft"></div></aside></div><div class="toolbar"><button class="primary" id="selection-confirm">确认范围</button><button id="selection-cancel">取消</button></div></section></div>`;
  const names = (ids) => cats.filter((c) => ids.has(c.id));
  function chips(ids, attr) {
    return (
      names(ids)
        .map(
          (c) =>
            `<button class="selection-chip" ${attr}="${esc(c.id)}" title="移除 ${esc(c.path.join(" / "))}">${esc(c.path.join(" / "))} ×</button>`,
        )
        .join("") || '<span class="note">尚未选择类目</span>'
    );
  }
  function applied() {
    $("selection-count").textContent = `已选 ${state.ids.size} 个三级类目`;
    $("selection-tags").innerHTML = chips(state.ids, "data-applied-remove");
  }
  const visible = () =>
    cats.filter(
      (c) =>
        (!$("selection-root").value ||
          c.path[0] === $("selection-root").value) &&
        (!$("selection-second").value ||
          c.path[1] === $("selection-second").value) &&
        c.path
          .join("/")
          .toLowerCase()
          .includes($("selection-search").value.trim().toLowerCase()),
    );
  function render() {
    const rows = visible();
    $("selection-options").innerHTML =
      rows
        .map(
          (c) =>
            `<label><input type="checkbox" data-selection-id="${c.id}" ${draft.has(c.id) ? "checked" : ""}>${esc(c.path.join(" / "))}</label>`,
        )
        .join("") || "<p>没有匹配类目</p>";
    $("selection-add").textContent = `全选当前结果（${rows.length}项）`;
    $("draft-count").textContent = `已选 ${draft.size} 项`;
    $("selection-draft").innerHTML = chips(draft, "data-draft-remove");
  }
  function seconds() {
    const root = $("selection-root").value;
    $("selection-second").innerHTML =
      '<option value="">全部二级</option>' +
      [
        ...new Set(
          cats.filter((c) => !root || c.path[0] === root).map((c) => c.path[1]),
        ),
      ]
        .map((v) => `<option>${esc(v)}</option>`)
        .join("");
    render();
  }
  function close() {
    $("selection-dialog").hidden = true;
    $("selection-edit").focus();
  }
  $("selection-edit").onclick = () => {
    draft = new Set(state.ids);
    $("selection-root").value = names(draft)[0]?.path[0] || "";
    seconds();
    $("selection-dialog").hidden = false;
    $("selection-search").focus();
  };
  $("selection-confirm").onclick = () => {
    state.ids = new Set(draft);
    applied();
    close();
    onChange();
  };
  $("selection-cancel").onclick = close;
  $("selection-dialog").onkeydown = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      const els = [
        ...$("selection-dialog").querySelectorAll("button,input,select"),
      ].filter((x) => !x.disabled);
      if (e.shiftKey && document.activeElement === els[0]) {
        e.preventDefault();
        els.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
        e.preventDefault();
        els[0].focus();
      }
    }
  };
  $("selection-root").onchange = seconds;
  $("selection-second").onchange = render;
  let timer;
  $("selection-search").oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  };
  $("selection-add").onclick = () => {
    visible().forEach((c) => draft.add(c.id));
    render();
  };
  $("selection-remove").onclick = () => {
    visible().forEach((c) => draft.delete(c.id));
    render();
  };
  $("selection-clear").onclick = () => {
    draft.clear();
    render();
  };
  $("selection-options").onchange = (e) => {
    const id = e.target.dataset.selectionId;
    if (id) {
      e.target.checked ? draft.add(id) : draft.delete(id);
      $("selection-draft").innerHTML = chips(draft, "data-draft-remove");
      $("draft-count").textContent = `已选 ${draft.size} 项`;
    }
  };
  $("selection-draft").onclick = (e) => {
    const b = e.target.closest("[data-draft-remove]");
    if (b) {
      draft.delete(b.dataset.draftRemove);
      render();
    }
  };
  $("selection-tags").onclick = (e) => {
    const b = e.target.closest("[data-applied-remove]");
    if (b) {
      state.ids.delete(b.dataset.appliedRemove);
      applied();
      onChange();
    }
  };
  $("industry-name").oninput = () => {
    state.name = $("industry-name").value;
    onChange();
  };
  function list() {
    $("scheme-list").innerHTML =
      '<option value="">选择已保存方案</option>' +
      schemes
        .map((v, i) => `<option value="${i}">${esc(v.name)}</option>`)
        .join("");
  }
  const scheme = () =>
    normalizeScheme(
      { version: 1, name: state.name, ids: [...state.ids] },
      cats,
    );
  $("scheme-save").onclick = () => {
    try {
      const v = scheme();
      const n = schemes.findIndex((x) => x.name === v.name);
      if (n >= 0) schemes[n] = v;
      else schemes.push(v);
      window.localStorage.setItem(KEY, JSON.stringify(schemes));
      list();
      message("已保存到本机");
    } catch (e) {
      message(e.message);
    }
  };
  $("scheme-list").onchange = () => {
    if ($("scheme-list").value === "") return;
    const v = schemes[+$("scheme-list").value];
    state.name = v.name;
    state.ids = new Set(v.ids);
    $("industry-name").value = state.name;
    applied();
    onChange();
    message("已载入方案");
  };
  $("scheme-export").onclick = () => {
    try {
      const v = scheme();
      download(
        new Blob([JSON.stringify(v, null, 2)], { type: "application/json" }),
        v.name.replace(/[\\/:*?"<>|]/g, "_") + ".json",
      );
      message("已导出方案");
    } catch (e) {
      message(e.message);
    }
  };
  $("scheme-import").onclick = () => $("scheme-file").click();
  $("scheme-file").onchange = async (e) => {
    try {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 200000) throw Error("方案文件过大");
      const v = normalizeScheme(JSON.parse(await f.text()), cats);
      state.name = v.name;
      state.ids = new Set(v.ids);
      $("industry-name").value = state.name;
      applied();
      onChange();
      message("已导入，可保存到本机");
    } catch (err) {
      message(err.message);
    } finally {
      e.target.value = "";
    }
  };
  applied();
  list();
}
