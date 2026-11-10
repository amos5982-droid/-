//@target illustrator
/*
  도련 3mm + 아트워크 외곽 칼선 만들기 (Adobe Illustrator 스크립트)

  하는 일
   1) 아트워크 바깥 윤곽을 따서 "칼선" 레이어(마젠타 선)를 맨 위에 만든다.
   2) 아트보드가 닿는 가장자리의 도형·이미지를 3mm 바깥으로 늘리고,
      아트보드를 사방 3mm 키운다. 기존 레이어 구조는 그대로 둔다.
   3) 원본은 건드리지 않고 "원본이름_도련칼선.ai" 복사본으로 저장한다.

  사용법: 파일 > 스크립트 > 기타 스크립트... 에서 이 파일을 선택.
  작업 대상은 현재 선택된(활성) 아트보드 하나다.
*/
(function () {
    var CONFIG = {
        bleedMM: 3,              // 도련 크기(mm)
        cutLayerName: "칼선",     // 칼선 레이어 이름
        cutStrokePt: 0.5,        // 칼선 두께(pt)
        cutOffsetMM: 0,          // 칼선을 바깥(+)/안쪽(-)으로 옮길 mm. 0이면 외곽 그대로
        removeInnerHoles: false, // true면 안쪽 구멍 선을 지우고 바깥 윤곽만 남김
        outlineStrokes: false,   // true면 선(stroke) 두께까지 윤곽에 포함 (실험적)
        saveCopy: true,          // 끝나면 _도련칼선.ai 복사본으로 저장
        edgeTolPt: 0.5           // 아트보드 가장자리로 볼 허용 오차(pt)
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
    var L = rect[0], R = rect[2];
    var T = Math.max(rect[1], rect[3]), B = Math.min(rect[1], rect[3]);

    var wmm = Math.round((R - L) / MM * 10) / 10, hmm = Math.round((T - B) / MM * 10) / 10;
    if (!confirm("아트보드 " + wmm + " x " + hmm + " mm 에 도련 " + CONFIG.bleedMM +
        "mm와 칼선을 만듭니다.\n원본 파일은 저장하지 않고, 끝나면 복사본으로 저장합니다.\n진행할까요?")) return;

    var restore = [];   // 잠금 상태 복원용
    var stats = { paths: 0, images: 0, skipped: {}, cutPieces: 0, imageRects: 0 };

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
            // 마젠타, 검정을 RGB로 근사
            rgb.red = k === 100 ? 0 : 255; rgb.green = k === 100 ? 0 : 0; rgb.blue = k === 100 ? 0 : 255;
            return rgb;
        }
        var cm = new CMYKColor();
        cm.cyan = c; cm.magenta = m; cm.yellow = y; cm.black = k;
        return cm;
    }
    function layersTopItems(container, skipLayer, out) {
        for (var i = 0; i < container.layers.length; i++) {
            var ly = container.layers[i];
            if (ly === skipLayer || !ly.visible) continue;
            for (var j = 0; j < ly.pageItems.length; j++) out.push(ly.pageItems[j]);
            layersTopItems(ly, skipLayer, out);
        }
        return out;
    }
    function hitsArtboard(gb) {
        return !(gb[2] < L || gb[0] > R || gb[1] < B || gb[3] > T);
    }

    // ---------- 1. 칼선 ----------
    var old = null;
    try { old = doc.layers.getByName(CONFIG.cutLayerName); } catch (e) {}
    if (old) {
        if (!confirm("'" + CONFIG.cutLayerName + "' 레이어가 이미 있습니다. 지우고 새로 만들까요?")) return;
        old.locked = false; old.visible = true; old.remove();
    }
    unlockLayers(doc);

    var cutLayer = doc.layers.add();
    cutLayer.name = CONFIG.cutLayerName;
    var blackColor = makeColor(0, 0, 0, 100);
    var needOutline = false;

    function findClip(group) {
        for (var i = 0; i < group.pageItems.length; i++) {
            var c = group.pageItems[i];
            if (c.typename === "PathItem" && c.clipping) return c;
            if (c.typename === "CompoundPathItem" && c.pathItems.length && c.pathItems[0].clipping) return c;
        }
        return null;
    }
    function addRect(gb) {
        var p = cutLayer.pathItems.rectangle(gb[1], gb[0], gb[2] - gb[0], gb[1] - gb[3]);
        p.filled = true; p.fillColor = blackColor; p.stroked = false;
        return p;
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
            d = item.duplicate(cutLayer, ElementPlacement.PLACEATEND);
            if (item.filled || item.closed) { d.filled = true; d.fillColor = blackColor; }
            if (item.stroked) { d.strokeColor = blackColor; needOutline = true; }
            out.push(d);
        } else if (t === "CompoundPathItem") {
            d = item.duplicate(cutLayer, ElementPlacement.PLACEATEND);
            for (i = 0; i < d.pathItems.length; i++) {
                d.pathItems[i].filled = true; d.pathItems[i].fillColor = blackColor;
            }
            out.push(d);
        } else if (t === "GroupItem") {
            var clip = findClip(item);
            if (clip) {
                d = clip.duplicate(cutLayer, ElementPlacement.PLACEATEND);
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
            d = item.duplicate(cutLayer, ElementPlacement.PLACEATEND);
            out.push(d.createOutline());
        } else {
            // 이미지 등: 경계 사각형으로 대신한다
            out.push(addRect(gb));
            stats.imageRects++;
        }
    }
    function allPaths(item, out) {
        var t = item.typename, i;
        if (t === "PathItem") out.push(item);
        else if (t === "CompoundPathItem") { for (i = 0; i < item.pathItems.length; i++) out.push(item.pathItems[i]); }
        else if (t === "GroupItem") { for (i = 0; i < item.pageItems.length; i++) allPaths(item.pageItems[i], out); }
        return out;
    }
    function bboxContains(a, b) { // a가 b를 완전히 감싸는가 (gb: l,t,r,b)
        return a[0] <= b[0] && a[1] >= b[1] && a[2] >= b[2] && a[3] <= b[3] &&
            ((a[2] - a[0]) * (a[1] - a[3]) > (b[2] - b[0]) * (b[1] - b[3]));
    }

    var shapes = [];
    var tops = layersTopItems(doc, cutLayer, []);
    for (var s = 0; s < tops.length; s++) addShapes(tops[s], shapes);

    if (shapes.length === 0) {
        cutLayer.remove();
        relock();
        alert("아트보드 위에서 칼선으로 쓸 아트워크를 찾지 못했습니다.");
        return;
    }

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

    if (CONFIG.cutOffsetMM !== 0) {
        try {
            var effect = '<LiveEffect name="Adobe Offset Path"><Dict data="R mlim 4 R ofst ' +
                (CONFIG.cutOffsetMM * MM) + ' I jntp 0 "/></LiveEffect>';
            for (var q = 0; q < cutLayer.pageItems.length; q++) cutLayer.pageItems[q].applyEffect(effect);
            doc.selection = null;
            doc.selection = cutLayer.pageItems;
            app.executeMenuCommand("expandStyle");
        } catch (e) {
            alert("칼선 간격(오프셋) 적용에 실패했습니다. 칼선 레이어에서 개체 > 패스 > 패스 간격 띄우기로 직접 적용하세요.\n" + e);
        }
    }

    var cutPaths = [];
    for (var c = 0; c < cutLayer.pageItems.length; c++) allPaths(cutLayer.pageItems[c], cutPaths);

    if (CONFIG.removeInnerHoles) {
        var drop = [];
        for (var a = 0; a < cutPaths.length; a++) {
            for (var b2 = 0; b2 < cutPaths.length; b2++) {
                if (a !== b2 && bboxContains(cutPaths[b2].geometricBounds, cutPaths[a].geometricBounds)) { drop.push(cutPaths[a]); break; }
            }
        }
        for (var dI = 0; dI < drop.length; dI++) { try { drop[dI].remove(); } catch (e) {} }
        cutPaths = [];
        for (c = 0; c < cutLayer.pageItems.length; c++) allPaths(cutLayer.pageItems[c], cutPaths);
    }

    var magenta = makeColor(0, 100, 0, 0);
    for (var k = 0; k < cutPaths.length; k++) {
        var cp = cutPaths[k];
        cp.filled = false; cp.stroked = true;
        cp.strokeColor = magenta; cp.strokeWidth = CONFIG.cutStrokePt;
        try { cp.strokeOverprint = false; cp.fillOverprint = false; } catch (e) {}
    }
    stats.cutPieces = cutPaths.length;
    doc.selection = null;

    // ---------- 2. 도련 ----------
    function extendPath(p) {
        if (p.guides) return;
        var changed = false;
        for (var i = 0; i < p.pathPoints.length; i++) {
            var pt = p.pathPoints[i], an = pt.anchor, ld = pt.leftDirection, rd = pt.rightDirection;
            var dx = 0, dy = 0;
            if (an[0] <= L + TOL && an[0] > L - BL) dx = (L - BL) - an[0];
            else if (an[0] >= R - TOL && an[0] < R + BL) dx = (R + BL) - an[0];
            if (an[1] >= T - TOL && an[1] < T + BL) dy = (T + BL) - an[1];
            else if (an[1] <= B + TOL && an[1] > B - BL) dy = (B - BL) - an[1];
            if (dx !== 0 || dy !== 0) {
                pt.anchor = [an[0] + dx, an[1] + dy];
                pt.leftDirection = [ld[0] + dx, ld[1] + dy];
                pt.rightDirection = [rd[0] + dx, rd[1] + dy];
                changed = true;
            }
        }
        if (changed) stats.paths++;
    }
    function extendBox(item) {
        var gb = item.geometricBounds, l = gb[0], t = gb[1], r = gb[2], b = gb[3];
        var nl = l, nt = t, nr = r, nb = b;
        if (l <= L + TOL && l > L - BL) nl = L - BL;
        if (r >= R - TOL && r < R + BL) nr = R + BL;
        if (t >= T - TOL && t < T + BL) nt = T + BL;
        if (b <= B + TOL && b > B - BL) nb = B - BL;
        if (nl === l && nt === t && nr === r && nb === b) return;
        var sx = (nr - nl) / (r - l) * 100, sy = (nt - nb) / (t - b) * 100;
        item.resize(sx, sy, true, true, true, true, 100, Transformation.CENTER);
        item.translate(((nl + nr) - (l + r)) / 2, ((nt + nb) - (t + b)) / 2);
        stats.images++;
    }
    function extendItem(item) {
        if (item.hidden) return;
        var gb;
        try { gb = item.geometricBounds; } catch (e) { return; }
        if (!hitsArtboard(gb)) return;
        unlock(item);
        var t = item.typename, i;
        if (t === "PathItem") extendPath(item);
        else if (t === "CompoundPathItem") { for (i = 0; i < item.pathItems.length; i++) extendPath(item.pathItems[i]); }
        else if (t === "GroupItem") {
            var kids = [];
            for (i = 0; i < item.pageItems.length; i++) kids.push(item.pageItems[i]);
            for (i = 0; i < kids.length; i++) extendItem(kids[i]);
        } else if (t === "RasterItem" || t === "PlacedItem") extendBox(item);
        else bump(t); // 글자, 심볼, 메시 등은 건드리지 않음
    }

    var art = layersTopItems(doc, cutLayer, []);
    for (var n = 0; n < art.length; n++) extendItem(art[n]);

    ab.artboardRect = yUp ? [L - BL, T + BL, R + BL, B - BL] : [L - BL, B - BL, R + BL, T + BL];

    relock();
    cutLayer.locked = false;
    doc.activeLayer = cutLayer;

    // ---------- 3. 복사본 저장 ----------
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
        "\n도련으로 늘린 도형: " + stats.paths + "개, 이미지: " + stats.images + "개" +
        (stats.imageRects ? "\n이미지·기타는 사각형 경계로 칼선을 땄습니다: " + stats.imageRects + "개" : "") +
        skipTxt + savedMsg +
        "\n\n도련 부분이 자연스러운지 눈으로 꼭 확인하세요.");
})();
