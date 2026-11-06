// Browser-side OOXML export: native editable Excel combo charts, no image embedding.
// Keep this adapter isolated from metrics/rendering. No external service or CDN required.
import { commonUnit } from "./trend-model.js?v=2.7.0";
import { rawRows } from "./trend-chart.js?v=2.7.0";
const xml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const enc = new TextEncoder(),
  ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function crc32(a) {
  let crc = -1;
  for (const b of a) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
export function zipFiles(files) {
  const chunks = [],
    directory = [];
  let offset = 0;
  const header = (len) => {
    const a = new Uint8Array(len);
    return [a, new DataView(a.buffer)];
  };
  for (const [path, str] of Object.entries(files)) {
    const name = enc.encode(path),
      data = enc.encode(str),
      crc = crc32(data),
      [local, l] = header(30);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x800, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, name.length, true);
    chunks.push(local, name, data);
    const [central, c] = header(46);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const size = directory.reduce((s, a) => s + a.length, 0),
    [end, e] = header(22);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, Object.keys(files).length, true);
  e.setUint16(10, Object.keys(files).length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
const col = (n) => {
  let s = "";
  for (n++; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
function cells(rows, start = 1, percentColumns = []) {
  return rows
    .map(
      (row, i) =>
        `<row r="${i + start}" ht="24" customHeight="1">${row
          .map((v, j) => {
            const address = col(j) + (i + start),
              style =
                i === 0
                  ? 1
                  : percentColumns.includes(j)
                    ? 3
                    : typeof v === "number" || v?.formula
                      ? 2
                      : 0;
            if (v === null || v === undefined)
              return `<c r="${address}" s="${style}"/>`;
            if (v?.formula)
              return `<c r="${address}" s="${style}"><f>${xml(v.formula)}</f><v>${v.value}</v></c>`;
            return typeof v === "number"
              ? `<c r="${address}" s="${style}"><v>${v}</v></c>`
              : `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
}
const relationships = (items) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${rel}/${type}" Target="${target}"/>`).join("")}</Relationships>`;
const rich = (t) =>
  `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>${xml(t)}</a:t></a:r></a:p></c:rich></c:tx>`;
function chartXml(m, unit, start) {
  const count = m.labels.length,
    ref = (c) => `'图表'!$${col(c)}$${start + 1}:$${col(c)}$${start + count}`;
  const cat = `<c:cat><c:strRef><c:f>${xml(ref(0))}</c:f><c:strCache><c:ptCount val="${count}"/>${m.labels.map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`).join("")}</c:strCache></c:strRef></c:cat>`;
  const values = (vs, c) =>
    `<c:val><c:numRef><c:f>${xml(ref(c))}</c:f><c:numCache><c:formatCode>0.00</c:formatCode><c:ptCount val="${count}"/>${vs.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : "")).join("")}</c:numCache></c:numRef></c:val>`;
  const bar = m.series
    .map(
      (s, i) =>
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${xml(s.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${s.color.slice(1)}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>${cat}${values(
          s.values.map((v) => (v === null ? null : v / unit.scale)),
          i + 1,
        )}</c:ser>`,
    )
    .join("");
  const catAxis = (id, cross, hidden) =>
    `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${hidden}"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/></c:catAx>`;
  const valAxis = (id, cross, pos, fmt, title) =>
    `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="${pos}"/><c:title>${rich(title)}<c:overlay val="0"/></c:title><c:numFmt formatCode="${fmt}" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="${pos === "r" ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx>`;
  return `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${rel}"><c:lang val="zh-CN"/><c:chart><c:title>${rich(m.title)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="stacked"/><c:varyColors val="0"/>${bar}<c:dLbls><c:numFmt formatCode="0.00" sourceLinked="0"/><c:dLblPos val="ctr"/><c:showLegendKey val="0"/><c:showVal val="1"/></c:dLbls><c:gapWidth val="100"/><c:overlap val="100"/><c:axId val="10"/><c:axId val="20"/></c:barChart><c:lineChart><c:grouping val="standard"/><c:ser><c:idx val="${m.series.length}"/><c:order val="${m.series.length}"/><c:tx><c:v>合计可比同比</c:v></c:tx><c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="444444"/></a:solidFill></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>${cat}${values(m.growth, m.series.length + 1)}<c:smooth val="0"/></c:ser><c:dLbls><c:numFmt formatCode="0.00%" sourceLinked="0"/><c:dLblPos val="t"/><c:showVal val="1"/></c:dLbls><c:axId val="30"/><c:axId val="40"/></c:lineChart>${catAxis(10, 20, 0)}${valAxis(20, 10, "l", "0.00", unit.label)}${catAxis(30, 40, 1)}${valAxis(40, 30, "r", "0.00%", "合计可比同比")}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}
export function editableWorkbook({
  model = null,
  rows = null,
  metadata = [],
  percentColumns = [],
}) {
  const raw = rows || rawRows(model),
    n = model ? 2 : 1,
    types = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
    ];
  const files = {};
  files["_rels/.rels"] = relationships([
    ["rId1", "officeDocument", "xl/workbook.xml"],
  ]);
  files["xl/workbook.xml"] =
    `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${model ? '<sheet name="图表" sheetId="1" r:id="rId1"/>' : ""}<sheet name="原始数据" sheetId="${n}" r:id="rId${n}"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
  files["xl/_rels/workbook.xml.rels"] = relationships([
    ...Array.from({ length: n }, (_, i) => [
      "rId" + (i + 1),
      "worksheet",
      "worksheets/sheet" + (i + 1) + ".xml",
    ]),
    ["rIdStyles", "styles", "styles.xml"],
  ]);
  files["xl/styles.xml"] =
    `<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF443B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4">${[0, 1, 2, 3].map((i) => `<xf numFmtId="${i === 3 ? 10 : i === 2 ? 4 : 0}" fontId="${i === 1 ? 1 : 0}" fillId="${i === 1 ? 2 : 0}" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`).join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const sheet = (body, drawing = "") =>
    `<worksheet xmlns="${ns}" xmlns:r="${rel}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="30" width="22" customWidth="1"/></cols><sheetData>${body}</sheetData>${drawing}</worksheet>`;
  files[`xl/worksheets/sheet${n}.xml`] = sheet(
    cells(raw, 1, model ? [raw[0].length - 1] : percentColumns) +
      cells([["范围与口径", "内容"], ...metadata], raw.length + 3),
  );
  if (model) {
    const unit = commonUnit(model.totals),
      start = 29,
      sourceCount = model.series.length;
    const data = [
      [
        "年份",
        ...model.series.map((s) => s.name + "（" + unit.label + "）"),
        "合计可比同比",
      ],
      ...model.labels.map((v, i) => [
        v,
        ...model.series.map((s, j) =>
          s.values[i] === null
            ? null
            : {
                formula: `'原始数据'!${col(j + 1)}${i + 2}/${unit.scale}`,
                value: s.values[i] / unit.scale,
              },
        ),
        model.growth[i] === null
          ? null
          : {
              formula: `IF('原始数据'!${col(sourceCount + 3)}${i + 2}>0,'原始数据'!${col(sourceCount + 2)}${i + 2}/'原始数据'!${col(sourceCount + 3)}${i + 2}-1,NA())`,
              value: model.growth[i],
            },
      ]),
    ];
    files["xl/worksheets/sheet1.xml"] = sheet(
      cells(data, start, [sourceCount + 1]),
      '<drawing r:id="rId1"/>',
    );
    files["xl/worksheets/_rels/sheet1.xml.rels"] = relationships([
      ["rId1", "drawing", "../drawings/drawing1.xml"],
    ]);
    files["xl/drawings/drawing1.xml"] =
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>26</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="可编辑组合图"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${rel}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
    files["xl/drawings/_rels/drawing1.xml.rels"] = relationships([
      ["rId1", "chart", "../charts/chart1.xml"],
    ]);
    files["xl/charts/chart1.xml"] = chartXml(model, unit, start);
  }
  files["[Content_Types].xml"] =
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${Array.from({ length: n }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${types[0]}"/>`).join("")}${model ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' : ""}</Types>`;
  return zipFiles(files);
}
