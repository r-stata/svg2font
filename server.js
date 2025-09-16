const express = require('express');
const multer = require('multer');
const fontCarrier = require('font-carrier');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 8888;

// 配置跨域
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 创建临时目录
const tempDir = path.join(__dirname, 'temp');
const uploadsDir = path.join(__dirname, 'uploads');
const fontsDir = path.join(tempDir, 'fonts');

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir);

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/svg+xml' || path.extname(file.originalname) === '.svg') {
      cb(null, true);
    } else {
      cb(new Error('只允许上传 SVG 文件'), false);
    }
  }
});

// 上传单个或多个 SVG 文件
app.post('/uploads', upload.array('svgs', 50), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请上传至少一个 SVG 文件' });
    }

    const fileInfo = req.files.map(file => ({
      id: path.basename(file.filename, '.svg'),
      originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      filename: file.filename
    }));

    res.json({ success: true, files: fileInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 生成字体文件
app.post('/generate-font', async (req, res) => {
  try {
    const { fontName = 'custom-font', mappings } = req.body;

    if (!mappings || mappings.length === 0) {
      return res.status(400).json({ error: '请提供字符映射关系' });
    }

    // 创建字体生成器
    const font = fontCarrier.create();

    // 添加图标到字体
    for (const mapping of mappings) {
      const { fileId, char } = mapping;
      const svgPath = path.join(uploadsDir, `${fileId}.svg`);

      if (!fs.existsSync(svgPath)) {
        return res.status(404).json({ error: `找不到文件: ${fileId}.svg` });
      }

      const svgContent = fs.readFileSync(svgPath, 'utf8');
      font.setSvg(char, svgContent);
    }

    // 生成唯一标识符用于文件名
    const uniqueId = uuidv4();
    const outputDir = path.join(fontsDir, uniqueId);
    fs.mkdirSync(outputDir);

    // 生成不同格式的字体文件
    font.output({
      path: path.join(outputDir, fontName),
      types: ['ttf', 'woff', 'woff2', 'eot', 'svg']
    });

    // 创建 ZIP 包
    const zip = new AdmZip();
    const files = fs.readdirSync(outputDir);
    
    files.forEach(file => {
      const filePath = path.join(outputDir, file);
      zip.addLocalFile(filePath, '', file);
    });

    // 保存 ZIP 包
    const zipFilePath = path.join(fontsDir, `${uniqueId}.zip`);
    zip.writeZip(zipFilePath);

    // 发送 ZIP 包给客户端
    res.download(zipFilePath, `${fontName}.zip`, (err) => {
      if (err) {
        console.error('下载错误:', err);
      }
      
      // 清理临时文件
      try {
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.unlinkSync(zipFilePath);
      } catch (cleanupErr) {
        console.error('清理临时文件错误:', cleanupErr);
      }
    });

  } catch (error) {
    console.error('生成字体错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 清理上传的临时文件
app.post('/cleanup', (req, res) => {
  try {
    // 清空上传目录
    if (fs.existsSync(uploadsDir)) {
      fs.readdirSync(uploadsDir).forEach(file => {
        const filePath = path.join(uploadsDir, file);
        fs.unlinkSync(filePath);
      });
    }
    
    res.json({ success: true, message: '临时文件已清理' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动服务器
app.listen(port, () => {
  console.log(`服务器运行在 http://localhost:${port}`);
});
