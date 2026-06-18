export function readImageForUpload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const image = new Image();
      image.onerror = () => reject(new Error("图片解析失败"));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 48;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, size, size);
        const data = context.getImageData(0, 0, size, size).data;
        let foreground = 0;
        let greenPixels = 0;
        let palePixels = 0;
        let bluePixels = 0;
        let purplePixels = 0;
        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        for (let index = 0; index < data.length; index += 4) {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const brightness = (r + g + b) / 3;
          if (brightness < 28) continue;
          foreground += 1;
          totalR += r;
          totalG += g;
          totalB += b;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const saturation = max ? (max - min) / max : 0;
          if (g > r * 1.04 && g > b * 1.02) greenPixels += 1;
          if (brightness > 118 && saturation < 0.34 && g >= r * 0.92) palePixels += 1;
          if (b > r * 1.05 && b >= g * 0.92) bluePixels += 1;
          if (r > g * 1.08 && b > g * 1.04 && Math.abs(r - b) < 80) purplePixels += 1;
        }
        const sampleCount = Math.max(foreground, 1);
        const greenRatio = greenPixels / sampleCount;
        const paleRatio = palePixels / sampleCount;
        const blueRatio = bluePixels / sampleCount;
        const purpleRatio = purplePixels / sampleCount;
        const avgR = totalR / sampleCount;
        const avgG = totalG / sampleCount;
        const avgB = totalB / sampleCount;
        const name = file.name.toLowerCase();
        const categoryGuess = name.includes("pendant") || name.includes("吊坠") || image.height > image.width * 1.18
          ? "吊坠"
          : name.includes("ring") || name.includes("戒指") || name.includes("指环")
            ? "戒指"
            : "";
        const dominantTone = purpleRatio > 0.12 && greenRatio > 0.08 ? "春彩" : purpleRatio > 0.12 ? "紫罗兰" : blueRatio > 0.26 ? "蓝水" : greenRatio > 0.34 ? "飘绿" : paleRatio > 0.35 && avgG >= avgR ? "晴底" : paleRatio > 0.35 ? "白冰" : avgG > avgR && avgG > avgB ? "绿色系" : "浅色";
        const waterGuess = paleRatio > 0.42 ? "冰种" : paleRatio > 0.24 ? "糯冰" : "糯种";
        const jadeScore = Math.min(99, Math.round(greenRatio * 62 + paleRatio * 32 + blueRatio * 16 + purpleRatio * 70 + (avgG >= avgR && avgG >= avgB ? 14 : 0)));
        const inferenceCanvas = document.createElement("canvas");
        const maxInferenceSide = 512;
        const inferenceScale = Math.min(1, maxInferenceSide / Math.max(image.width, image.height, 1));
        inferenceCanvas.width = Math.max(1, Math.round(image.width * inferenceScale));
        inferenceCanvas.height = Math.max(1, Math.round(image.height * inferenceScale));
        inferenceCanvas.getContext("2d").drawImage(image, 0, 0, inferenceCanvas.width, inferenceCanvas.height);
        resolve({
          name: file.name,
          dataUrl,
          visionDataUrl: inferenceCanvas.toDataURL("image/jpeg", 0.76),
          analysis: {
            width: image.width,
            height: image.height,
            aspectRatio: Number((image.width / Math.max(image.height, 1)).toFixed(2)),
            foregroundRatio: Number((foreground / (size * size)).toFixed(2)),
            greenRatio: Number(greenRatio.toFixed(3)),
            paleRatio: Number(paleRatio.toFixed(3)),
            blueRatio: Number(blueRatio.toFixed(3)),
            purpleRatio: Number(purpleRatio.toFixed(3)),
            avgRgb: [Math.round(avgR), Math.round(avgG), Math.round(avgB)],
            jadeScore,
            isJadeLike: jadeScore >= 24 || purpleRatio > 0.12,
            categoryGuess,
            dominantTone,
            waterGuess,
            shapeGuess: categoryGuess === "手镯" ? "正圈" : categoryGuess === "吊坠" ? "水滴" : "",
          }
        });
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
