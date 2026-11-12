//@target illustrator
/*
  도련 3mm + 아트워크 외곽 칼선 만들기 (Adobe Illustrator 스크립트)

  도련은 "칼선 바깥으로 3mm 더 인쇄해 두는 것"이다. 이 스크립트는
   1) 아트워크 바깥 윤곽을 따서 "칼선" 레이어(마젠타 선)를 맨 위에 만든다.
   2) 클리핑 마스크로 묶인 배경(예: 파란 사각형)은 마스크와 안쪽 이미지를 3mm 바깥으로 키운다.
   3) 그 밖의 아트워크(예: 선수 사진의 흰 테두리)는 윤곽을 3mm 부풀린 흰색 도형을 만들어
      맨 아래 "도련_흰색" 레이어에 둔다. 마스크 배경 위쪽 부분은 배경에 가려져서 바깥 부분만 보인다.
   4) 아트보드를 도련이 들어가게 키우고, 원본은 두고 "원본이름_도련칼선.ai" 복사본으로 저장한다.
  기존 레이어와 개체는 지우거나 합치지 않는다.

  사용법: 파일 > 스크립트 > 기타 스크립트... 에서 이 파일을 선택.
*/
(function () {
    var CONFIG = {
        bleedMM: 3,                    // 도련 크기(mm)
        cutLayerName: "칼선",           // 칼선 레이어 이름
        cutStrokePt: 0.5,              // 칼선 두께(pt)
        cutOffsetMM: 0,                // 칼선을 바깥(+)/안쪽(-)으로 옮길 mm. 0이면 외곽 그대로
        cutSourceLayers: ["배경", "테두리"], // 칼선과 도련을 따는 데 쓸 레이어 이름들. 비우면 보이는 모든 레이어
        whiteBleedLayerName: "도련_흰색", // 흰색 도련 도형을 담을 레이어 이름
        whiteBleedSourceLayers: [],    // 흰색 도련으로 부풀릴 레이어 이름들. 비우면 위 레이어에서 마스크 묶음을 뺀 나머지
        removeInnerHoles: true,        // true면 안쪽 구멍 선을 지우고 바깥 윤곽만 남김
        traceImages: true,             // true면 사진을 이미지 추적으로 투명 배경 윤곽대로 땀. false면 사각형
        outlineStrokes: false,         // true면 선(stroke) 두께까지 윤곽에 포함 (실험적)
        saveCopy: true,                // 끝나면 _도련칼선.ai 복사본으로 저장
        edgeTolPt: 0.5                 // 가장자리로 볼 허용 오차(pt)
    };

    var MM = 72 / 25.4;
    var BL = CONFIG.bleedMM * MM;
    var TOL = CONFIG.edgeTolPt;

    if (app.documents.length === 0) { alert("열려 있는 문서가 없습니다."); return; }
    app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    var doc = app.activeDocument;
    var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
    var rect = ab.artboardRect;
    var yUp = rect[1] >= rect[3];
    var AL = rect[0], AR = rect[2];
    var AT = Math.max(rect[1], rect[3]), AB = Math.min(rect[1], rect[3]);

    if (!confirm("도련 " + CONFIG.bleedMM + "mm와 칼선을 만듭니다.\n" +
        "원본 파일은 저장하지 않고, 끝나면 복사본으로 저장합니다.\n진행할까요?")) return;

    var restore = [];
    var stats = { maskGroups: 0, paths: 0, images: 0, skipped: {}, cutPieces: 0, whitePieces: 0, imageRects: 0, traced: 0 };

    function bump(name) { stats.skipped[name] = (stats.skipped[name] || 0) + 1; }
    function unlock(obj) {
        try { if (obj.locked) { restore.push(obj); obj.locked = false; } } catch (e) {}
    }
    function unlockLayers(container) {
        for (var i = 0; i < container.layers.length; i++) {
            var ly = container.layers[i];
            unlock(ly);
            unlockLayers(ly);
        }
    }
    function relock() {
        for (var i = 0; i < restore.length; i++) { try { restore[i].locked = true; } catch (e) {} }
    }
    function makeColor(c, m, y, k) {
        if (doc.documentColorSpace === DocumentColorSpace.RGB) {
            var rgb = new RGBColor();
            rgb.red = 255 * (1 - c / 100) * (1 - k / 100);
            rgb.green = 255 * (1 - m / 100) * (1 - k / 100);
            rgb.blue = 255 * (1 - y / 100) * (1 - k / 100);
            return rgb;
        }
        var cm = new CMYKColor();
        cm.cyan = c; cm.magenta = m; cm.yellow = y; cm.black = k;
        return cm;
    }
    function inNames(name, names) {
        for (var i = 0; i < names.length; i++) if (name.indexOf(names[i]) >= 0) return true; // 이름에 포함되면 사용
        return false;
    }
    function layersTopItems(container, skipLayer, out, names, parentOk) {
        for (var i = 0; i < container.layers.length; i++) {
            var ly = container.layers[i];
            if (ly === skipLayer || !ly.visible) continue;
            var ok = !names || names.length === 0 || parentOk || inNames(ly.name, names);
            if (ok) for (var j = 0; j < ly.pageItems.length; j++) out.push(ly.pageItems[j]);
            layersTopItems(ly, skipLayer, out, names, ok && !!names && names.length > 0);
        }
        return out;
    }
    function allPaths(item, out) {
        var t = item.typename, i;
        if (t === "PathItem") out.push(item);
        else if (t === "CompoundPathItem") { for (i = 0; i < item.pathItems.length; i++) out.push(item.pathItems[i]); }
        else if (t === "GroupItem") { for (i = 0; i < item.pageItems.length; i++) allPaths(item.pageItems[i], out); }
        return out;
    }
    function layerPaths(layer) {
        var res = [];
        for (var c = 0; c < layer.pageItems.length; c++) allPaths(layer.pageItems[c], res);
        return res;
    }
    function bboxContains(a, b) { // a가 b를 완전히 감싸는가 (gb: l,t,r,b)
        return a[0] <= b[0] && a[1] >= b[1] && a[2] >= b[2] && a[3] <= b[3] &&
            ((a[2] - a[0]) * (a[1] - a[3]) > (b[2] - b[0]) * (b[1] - b[3]));
    }
    function findClip(group) {
        for (var i = 0; i < group.pageItems.length; i++) {
            var c = group.pageItems[i];
            if (c.typename === "PathItem" && c.clipping) return c;
            if (c.typename === "CompoundPathItem" && c.pathItems.length && c.pathItems[0].clipping) return c;
        }
        return null;
    }

    // ---------- 윤곽 만들기 ----------
    var workLayer = null;      // 복제본을 모아 합칠 레이어
    var needOutline = false;
    var skipClipped = false;   // true면 클리핑 마스크 묶음은 건너뜀

    function hitsArtboard(gb) {
        return !(gb[2] < AL || gb[0] > AR || gb[1] < AB || gb[3] > AT);
    }
    function addRect(gb) {
        var p = workLayer.pathItems.rectangle(gb[1], gb[0], gb[2] - gb[0], gb[1] - gb[3]);
        p.filled = true; p.fillColor = blackColor; p.stroked = false;
        return p;
    }
    function isFullRect(p, gb) {
        if (p.typename !== "PathItem" || p.pathPoints.length > 5) return false;
        var b = p.geometricBounds;
        return Math.abs(b[0] - gb[0]) < 1 && Math.abs(b[1] - gb[1]) < 1 &&
            Math.abs(b[2] - gb[2]) < 1 && Math.abs(b[3] - gb[3]) < 1;
    }
    // 이미지 추적으로 투명하지 않은 부분의 윤곽 도형들을 얻는다. 실패하면 null.
    function traceSilhouette(item, gb) {
        var d = null;
        try {
            d = item.duplicate(workLayer, ElementPlacement.PLACEATEND);
            var tr = d.trace();
            var o = tr.tracing.tracingOptions;
            o.tracingMode = TracingModeType.TRACINGMODECOLOR;
            try { o.fills = true; o.strokes = false; o.ignoreWhite = false; } catch (e1) {}
            try { o.pathFidelity = 50; o.cornerAngle = 20; o.minimumArea = 10; } catch (e2) {}
            app.redraw();
            var grp = tr.tracing.expandTracing();
            var kids = [], res = [], i;
            for (i = 0; i < grp.pageItems.length; i++) kids.push(grp.pageItems[i]);
            for (i = 0; i < kids.length; i++) {
                if (isFullRect(kids[i], gb)) continue; // 투명 배경이 흰 사각형으로 잡힌 경우 버림
                kids[i].move(workLayer, ElementPlacement.PLACEATEND);
                res.push(kids[i]);
            }
            grp.remove();
            if (res.length === 0) return null;
            return res;
        } catch (e) {
            try { if (d) d.remove(); } catch (e3) {}
            return null;
        }
    }
    function hasImageInsideClip(group, clip) {
        var cb = clip.geometricBounds, found = false;
        for (var i = 0; i < group.pageItems.length; i++) {
            var c = group.pageItems[i];
            if (c.typename !== "RasterItem" && c.typename !== "PlacedItem") continue;
            found = true;
            var b = c.geometricBounds;
            if (b[0] < cb[0] - 1 || b[1] > cb[1] + 1 || b[2] > cb[2] + 1 || b[3] < cb[3] - 1) return false;
        }
        return found;
    }
    function addShapes(item, out) {
        if (item.hidden) return;
        var gb;
        try { if (item.opacity === 0) return; gb = item.geometricBounds; } catch (e) { return; }
        if (!hitsArtboard(gb)) return;
        unlock(item);
        var t = item.typename, d, i;

        if (t === "PathItem") {
            if (item.guides || item.clipping) return;
            d = item.duplicate(workLayer, ElementPlacement.PLACEATEND);
            if (item.filled || item.closed) { d.filled = true; d.fillColor = blackColor; }
            if (item.stroked) { d.strokeColor = blackColor; needOutline = true; }
            out.push(d);
        } else if (t === "CompoundPathItem") {
            d = item.duplicate(workLayer, ElementPlacement.PLACEATEND);
            for (i = 0; i < d.pathItems.length; i++) {
                d.pathItems[i].filled = true; d.pathItems[i].fillColor = blackColor;
            }
            out.push(d);
        } else if (t === "GroupItem") {
            if (skipClipped && item.clipped) return;
            var clip = findClip(item);
            if (clip && CONFIG.traceImages && hasImageInsideClip(item, clip)) clip = null;
            if (clip) {
                d = clip.duplicate(workLayer, ElementPlacement.PLACEATEND);
                try {
                    if (d.typename === "CompoundPathItem") {
                        for (i = 0; i < d.pathItems.length; i++) {
                            d.pathItems[i].clipping = false;
                            d.pathItems[i].filled = true; d.pathItems[i].fillColor = blackColor; d.pathItems[i].stroked = false;
                        }
                    } else {
                        d.clipping = false; d.filled = true; d.fillColor = blackColor; d.stroked = false;
                    }
                } catch (e) {}
                out.push(d);
            } else {
                var kids = [];
                for (i = 0; i < item.pageItems.length; i++) kids.push(item.pageItems[i]);
                for (i = 0; i < kids.length; i++) addShapes(kids[i], out);
            }
        } else if (t === "TextFrame") {
            d = item.duplicate(workLayer, ElementPlacement.PLACEATEND);
            out.push(d.createOutline());
        } else {
            var isImg = (t === "RasterItem" || t === "PlacedItem");
            var traced = (isImg && CONFIG.traceImages) ? traceSilhouette(item, gb) : null;
            if (traced) {
                for (i = 0; i < traced.length; i++) out.push(traced[i]);
                stats.traced++;
            } else {
                out.push(addRect(gb));
                stats.imageRects++;
            }
        }
    }
    // items를 복제해서 workLayer에 하나의 바깥 윤곽으로 합친다. 결과 패스 배열을 돌려준다.
    function makeOutline(items, offsetMM) {
        needOutline = false;
        var shapes = [], s, q;
        for (s = 0; s < items.length; s++) addShapes(items[s], shapes);
        if (shapes.length === 0) return [];

        if (needOutline && CONFIG.outlineStrokes) {
            try { doc.selection = null; doc.selection = shapes; app.executeMenuCommand("OffsetPath v22"); } catch (e) {}
        }
        if (shapes.length > 1) {
            try {
                doc.selection = null;
                doc.selection = shapes;
                app.executeMenuCommand("Live Pathfinder Add");
                app.executeMenuCommand("expandStyle");
            } catch (e) {
                alert("도형 합치기(패스파인더)에 실패했습니다: " + e);
            }
        }
        if (offsetMM !== 0) {
            try {
                var effect = '<LiveEffect name="Adobe Offset Path"><Dict data="R mlim 4 R ofst ' +
                    (offsetMM * MM) + ' I jntp 0 "/></LiveEffect>';
                for (q = 0; q < workLayer.pageItems.length; q++) workLayer.pageItems[q].applyEffect(effect);
                doc.selection = null;
                doc.selection = workLayer.pageItems;
                app.executeMenuCommand("expandStyle");
            } catch (e) {
                alert("칼선 간격(오프셋) 적용에 실패했습니다. 레이어에서 개체 > 패스 > 패스 간격 띄우기로 직접 적용하세요.\n" + e);
            }
        }
        var paths = layerPaths(workLayer);
        if (CONFIG.removeInnerHoles) {
            var drop = [], a, b2;
            for (a = 0; a < paths.length; a++) {
                for (b2 = 0; b2 < paths.length; b2++) {
                    if (a !== b2 && bboxContains(paths[b2].geometricBounds, paths[a].geometricBounds)) { drop.push(paths[a]); break; }
                }
            }
            for (q = 0; q < drop.length; q++) { try { drop[q].remove(); } catch (e) {} }
            paths = layerPaths(workLayer);
        }
        doc.selection = null;
        return paths;
    }

    // ---------- 준비 ----------
    var old = null;
    try { old = doc.layers.getByName(CONFIG.cutLayerName); } catch (e) {}
    if (old) {
        if (!confirm("'" + CONFIG.cutLayerName + "' 레이어가 이미 있습니다. 지우고 새로 만들까요?")) return;
        old.locked = false; old.visible = true; old.remove();
    }
    var oldW = null;
    try { oldW = doc.layers.getByName(CONFIG.whiteBleedLayerName); } catch (e) {}
    if (oldW) { oldW.locked = false; oldW.visible = true; oldW.remove(); }
    unlockLayers(doc);

    var blackColor = makeColor(0, 0, 0, 100);
    var cutLayer = doc.layers.add();
    cutLayer.name = CONFIG.cutLayerName;

    var tops = layersTopItems(doc, cutLayer, [], CONFIG.cutSourceLayers, false);
    if (tops.length === 0) {
        var nm = [];
        for (var li = 0; li < doc.layers.length; li++) nm.push("- " + doc.layers[li].name);
        cutLayer.remove();
        relock();
        alert("cutSourceLayers에 적은 이름의 레이어를 찾지 못했습니다.\n현재 레이어:\n" + nm.join("\n") +
            "\n\n파일 맨 위 CONFIG의 cutSourceLayers를 위 이름에 맞게 고치세요.");
        return;
    }
    // 어떤 레이어가 쓰이는지 보여 준다 (이름이 안 맞아서 빠지는 일을 막기 위해)
    function describeLayers(container, indent, parentOk, lines) {
        for (var i = 0; i < container.layers.length; i++) {
            var ly = container.layers[i];
            var names = CONFIG.cutSourceLayers;
            var ok = names.length === 0 || parentOk || inNames(ly.name, names);
            var kinds = {}, j, tp, desc = [];
            for (j = 0; j < ly.pageItems.length; j++) { tp = ly.pageItems[j].typename; kinds[tp] = (kinds[tp] || 0) + 1; }
            for (tp in kinds) desc.push(tp.replace("Item", "") + " " + kinds[tp]);
            lines.push(indent + (ly === cutLayer ? "(칼선 레이어)" : ((ok && ly.visible ? "[사용] " : "[제외] ") + (ly.visible ? "" : "(숨김) ")) + ly.name + (desc.length ? " : " + desc.join(", ") : "")));
            describeLayers(ly, indent + "    ", ok && names.length > 0, lines);
        }
    }
    var lineList = [];
    describeLayers(doc, "", false, lineList);
    if (!confirm("아래 레이어로 칼선과 도련을 만듭니다.\n\n" + lineList.join("\n") +
        "\n\n[제외]인데 써야 하는 레이어가 있으면 취소하고, 파일 맨 위 cutSourceLayers 이름을 고치세요.")) {
        cutLayer.remove();
        relock();
        return;
    }
    var whiteItems = (CONFIG.whiteBleedSourceLayers.length > 0)
        ? layersTopItems(doc, cutLayer, [], CONFIG.whiteBleedSourceLayers, false)
        : tops;

    // ---------- 1. 칼선 ----------
    workLayer = cutLayer;
    skipClipped = false;
    var cutPaths = makeOutline(tops, CONFIG.cutOffsetMM);
    if (cutPaths.length === 0) {
        cutLayer.remove();
        relock();
        alert("아트보드 위에서 칼선으로 쓸 아트워크를 찾지 못했습니다.");
        return;
    }
    var magenta = makeColor(0, 100, 0, 0);
    var cl = Infinity, cb = Infinity, cr = -Infinity, ct = -Infinity;
    for (var k = 0; k < cutPaths.length; k++) {
        var cp = cutPaths[k];
        cp.filled = false; cp.stroked = true;
        cp.strokeColor = magenta; cp.strokeWidth = CONFIG.cutStrokePt;
        try { cp.strokeOverprint = false; cp.fillOverprint = false; } catch (e) {}
        var g = cp.geometricBounds;
        cl = Math.min(cl, g[0]); ct = Math.max(ct, g[1]); cr = Math.max(cr, g[2]); cb = Math.min(cb, g[3]);
    }
    stats.cutPieces = cutPaths.length;

    // ---------- 2. 마스크 배경(파란 사각형 등) 키우기 ----------
    function extendPath(p, fr) {
        if (p.guides) return;
        var changed = false;
        for (var i = 0; i < p.pathPoints.length; i++) {
            var pt = p.pathPoints[i], an = pt.anchor, ld = pt.leftDirection, rd = pt.rightDirection;
            var dx = 0, dy = 0;
            if (an[0] <= fr.L + TOL && an[0] > fr.L - BL) dx = (fr.L - BL) - an[0];
            else if (an[0] >= fr.R - TOL && an[0] < fr.R + BL) dx = (fr.R + BL) - an[0];
            if (an[1] >= fr.T - TOL && an[1] < fr.T + BL) dy = (fr.T + BL) - an[1];
            else if (an[1] <= fr.B + TOL && an[1] > fr.B - BL) dy = (fr.B - BL) - an[1];
            if (dx !== 0 || dy !== 0) {
                pt.anchor = [an[0] + dx, an[1] + dy];
                pt.leftDirection = [ld[0] + dx, ld[1] + dy];
                pt.rightDirection = [rd[0] + dx, rd[1] + dy];
                changed = true;
            }
        }
        if (changed) stats.paths++;
    }
    // 마스크 전체를 덮던 배경 이미지를, 키운 마스크도 덮도록 균일 확대
    function coverImage(item, fr) {
        var gb = item.geometricBounds, l = gb[0], t = gb[1], r = gb[2], b = gb[3];
        if (!(l <= fr.L + TOL && r >= fr.R - TOL && t >= fr.T - TOL && b <= fr.B + TOL)) return; // 배경 이미지가 아님
        var nL = fr.L - BL, nR = fr.R + BL, nT = fr.T + BL, nB = fr.B - BL;
        if (l <= nL && r >= nR && t >= nT && b <= nB) return; // 이미 충분히 큼
        var s = Math.max((nR - nL) / (r - l), (nT - nB) / (t - b), 1);
        item.resize(s * 100, s * 100, true, true, true, true, 100, Transformation.CENTER);
        gb = item.geometricBounds; l = gb[0]; t = gb[1]; r = gb[2]; b = gb[3];
        var dx = 0, dy = 0;
        if (l > nL) dx = nL - l; else if (r < nR) dx = nR - r;
        if (t < nT) dy = nT - t; else if (b > nB) dy = nB - b;
        if (dx !== 0 || dy !== 0) item.translate(dx, dy);
        stats.images++;
    }
    function inflateItem(item, fr) {
        if (item.hidden) return;
        unlock(item);
        var t = item.typename, i;
        if (t === "PathItem") extendPath(item, fr);
        else if (t === "CompoundPathItem") { for (i = 0; i < item.pathItems.length; i++) extendPath(item.pathItems[i], fr); }
        else if (t === "GroupItem") {
            var kids = [];
            for (i = 0; i < item.pageItems.length; i++) kids.push(item.pageItems[i]);
            for (i = 0; i < kids.length; i++) inflateItem(kids[i], fr);
        } else if (t === "RasterItem" || t === "PlacedItem") coverImage(item, fr);
        else bump(t); // 글자, 심볼 등은 건드리지 않음
    }
    function inflateMasks(item) {
        if (item.hidden || item.typename !== "GroupItem") return;
        unlock(item);
        if (item.clipped) {
            var clip = findClip(item);
            if (!clip) return;
            var b = clip.geometricBounds;
            var fr = { L: b[0], T: b[1], R: b[2], B: b[3] };
            var kids = [], i;
            for (i = 0; i < item.pageItems.length; i++) kids.push(item.pageItems[i]);
            for (i = 0; i < kids.length; i++) inflateItem(kids[i], fr);
            stats.maskGroups++;
        } else {
            var ch = [], j;
            for (j = 0; j < item.pageItems.length; j++) ch.push(item.pageItems[j]);
            for (j = 0; j < ch.length; j++) inflateMasks(ch[j]);
        }
    }
    for (var n = 0; n < tops.length; n++) inflateMasks(tops[n]);

    // ---------- 3. 흰색 도련 (마스크 배경 바깥으로 나온 부분) ----------
    var whiteLayer = doc.layers.add();
    whiteLayer.name = CONFIG.whiteBleedLayerName;
    workLayer = whiteLayer;
    skipClipped = true;
    var whitePaths = makeOutline(whiteItems, 0);
    var white = makeColor(0, 0, 0, 0);
    for (var w = 0; w < whitePaths.length; w++) {
        var wp = whitePaths[w];
        wp.filled = true; wp.fillColor = white;
        wp.stroked = true; wp.strokeColor = white; wp.strokeWidth = BL * 2;
        try { wp.strokeJoin = StrokeJoin.ROUNDENDJOIN; wp.strokeCap = StrokeCap.ROUNDENDCAP; } catch (e) {}
        try { wp.strokeOverprint = false; wp.fillOverprint = false; } catch (e) {}
    }
    stats.whitePieces = whitePaths.length;
    if (whitePaths.length === 0) whiteLayer.remove();
    else whiteLayer.zOrder(ZOrderMethod.SENDTOBACK);

    // ---------- 4. 아트보드 키우기 ----------
    var nl = Math.min(AL, cl - BL), nr = Math.max(AR, cr + BL);
    var nt = Math.max(AT, ct + BL), nb = Math.min(AB, cb - BL);
    ab.artboardRect = yUp ? [nl, nt, nr, nb] : [nl, nb, nr, nt];

    relock();
    cutLayer.locked = false;
    doc.activeLayer = cutLayer;
    doc.selection = null;

    // ---------- 5. 복사본 저장 ----------
    var savedMsg = "";
    if (CONFIG.saveCopy) {
        try {
            var f = doc.fullName;
            var base = decodeURI(f.name).replace(/\.ai$/i, "");
            var outFile = new File(f.parent.absoluteURI + "/" + encodeURI(base + "_도련칼선.ai"));
            var opts = new IllustratorSaveOptions();
            opts.pdfCompatible = true;
            opts.compatibility = Compatibility.ILLUSTRATOR17;
            doc.saveAs(outFile, opts);
            savedMsg = "\n저장: " + decodeURI(outFile.name);
        } catch (e) {
            savedMsg = "\n(복사본 저장은 건너뜀: 문서를 먼저 저장하거나 직접 '다른 이름으로 저장'하세요)";
        }
    }

    var skipTxt = "";
    for (var key in stats.skipped) skipTxt += "\n  - " + key + " " + stats.skipped[key] + "개 (늘리지 않음)";
    alert("완료\n칼선 조각: " + stats.cutPieces + "개" +
        (stats.cutPieces > 1 ? " (하나로 합쳐지지 않았습니다. 겹치지 않는 조각이나 합치기 실패가 있는지 칼선 레이어를 확인하세요)" : " (하나로 통합됨)") +
        "\n마스크 배경 키움: " + stats.maskGroups + "개 (도형 " + stats.paths + ", 이미지 " + stats.images + ")" +
        "\n흰색 도련 도형: " + stats.whitePieces + "개" +
        (stats.traced ? "\n이미지 윤곽 추적: " + stats.traced + "개" : "") +
        (stats.imageRects ? "\n사각형 경계로 윤곽을 딴 이미지·기타: " + stats.imageRects + "개" : "") +
        skipTxt + savedMsg +
        "\n\n도련 부분이 자연스러운지 눈으로 꼭 확인하세요.");
})();
