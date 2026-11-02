import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const datasetDir = path.join(rootDir, "testsets", "curtain_eval_seedream_window_balanced_v1");
const mockSkuJsonPath = path.join(datasetDir, "mock_sku_catalog.json");
const mockSkuCsvPath = path.join(datasetDir, "mock_sku_catalog.csv");
const metadataJsonPath = path.join(datasetDir, "metadata.json");
const metadataCsvPath = path.join(datasetDir, "metadata.csv");
const sceneEvalJsonPath = path.join(datasetDir, "scene_window_eval.json");
const sceneEvalCsvPath = path.join(datasetDir, "scene_window_eval.csv");
const readmePath = path.join(datasetDir, "README.md");

const curatedSkuMap = {
  "CUR-00607881": {
    name: 'TERESIA sheer curtains, 1 pair, white/with rod pocket, 57x84" - IKEA',
    window_types: ["标准窗", "落地窗", "飘窗", "拱形窗"],
    usage_note: "轻透柔和，适合标准窗、飘窗和拱形窗做柔光层，也适合落地窗叠搭遮光帘。"
  },
  "CUR-30386538": {
    name: 'GJERTRUD sheer curtains, 1 pair, white/with heading tape, 57x118" - IKEA',
    window_types: ["落地窗", "大宽窗", "阳台门", "滑门/移门", "法式门窗"],
    usage_note: "长款纱帘更适合落地窗、阳台门和法式门窗，强调采光和轻盈感。"
  },
  "CUR-30566577": {
    name: 'PRAERIEOXALIS panel curtain, yellow, 24x118" - IKEA',
    window_types: ["滑门/移门", "阳台门", "大宽窗", "落地窗"],
    usage_note: "面板帘更适合滑门、阳台门和大宽窗，开合利落，适合现代极简空间。"
  },
  "CUR-00291297": {
    name: 'BORGHILD sheer curtains, 1 pair, white, 57x98" - IKEA',
    window_types: ["标准窗", "飘窗", "小窗", "拱形窗"],
    usage_note: "适合标准窗、飘窗和小窗做轻柔透光方案，也适合拱形窗搭配高位轨道。"
  },
  "CUR-80063833": {
    name: 'RITVA curtains with tie-backs, 1 pair, white/with heading tape, 57x118" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "阳台门", "法式门窗"],
    usage_note: "通用布帘方案，适合标准窗到大宽窗，也能覆盖阳台门和法式门窗。"
  },
  "CUR-00466715": {
    name: 'DYTAG curtains, 1 pair, white/with heading tape, 57x98" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "法式门窗"],
    usage_note: "亚麻感更适合标准窗、落地窗和法式门窗，强调自然垂坠。"
  },
  "CUR-10569218": {
    name: 'ANGSFRYLE sheer curtain, 1 piece, white/with heading tape, 118x98" - IKEA',
    window_types: ["大宽窗", "落地窗", "阳台门", "法式门窗", "拱形窗"],
    usage_note: "宽幅纱帘适合大宽窗、落地窗和法式门窗，也能用于拱形窗的整墙柔光处理。"
  },
  "CUR-40111987": {
    name: 'MERETE room darkening curtains, 1 pair, white/with eyelets, 57x98" - IKEA',
    window_types: ["标准窗", "落地窗", "阳台门", "法式门窗"],
    usage_note: "适合需要遮光和隐私的标准窗、落地窗和法式门窗。"
  },
  "CUR-80569026": {
    name: 'HAGGVECKMAL room darkening curtains, 1 pair, dark gray/with heading tape, 57x98" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "阳台门", "法式门窗"],
    usage_note: "深色遮光款适合卧室向的大窗、阳台门和法式门窗，压光效果更稳定。"
  },
  "CUR-90591003": {
    name: 'VILBORG room darkening curtains, 1 pair, pink/with heading tape, 57x84" - IKEA',
    window_types: ["标准窗", "小窗", "飘窗"],
    usage_note: "更适合标准窗、小窗和飘窗，适合卧室或儿童房做柔和遮光。"
  },
  "CUR-90111980": {
    name: 'LILL sheer curtains, 1 pair, white/with rod pocket, 110x98" - IKEA',
    window_types: ["标准窗", "大宽窗", "落地窗", "飘窗", "拱形窗"],
    usage_note: "适合标准窗到大宽窗的柔光需求，也适合飘窗和拱形窗做轻透层。"
  },
  "CUR-40552891": {
    name: 'DYTAG curtains, 1 pair, gray-green/with heading tape, 57x98" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "法式门窗"],
    usage_note: "自然纹理布帘，适合标准窗、落地窗和法式门窗。"
  },
  "CUR-20602137": {
    name: 'BENGTA block-out curtain, 1 piece, beige/with heading tape, 83x98" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "阳台门", "滑门/移门"],
    usage_note: "单片宽幅遮光帘适合大窗和滑门，也适合阳台门做强遮光。"
  },
  "CUR-30156486": {
    name: 'RITVA curtains with tie-backs, 1 pair, gray/with heading tape, 57x98" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "阳台门", "法式门窗"],
    usage_note: "灰色通用布帘，适合客厅和卧室的大多数标准窗、落地窗和法式门窗。"
  },
  "CUR-20112011": {
    name: 'ALVINE SPETS sheer curtains, 1 pair, off-white/with rod pocket, 57x98" - IKEA',
    window_types: ["标准窗", "小窗", "飘窗", "拱形窗"],
    usage_note: "花边纱帘更适合小窗、飘窗和拱形窗，强调轻柔装饰感。"
  },
  "CUR-40603008": {
    name: 'GINSTMOTT curtains, 1 pair, pink/with heading tape, 57x84" - IKEA',
    window_types: ["标准窗", "小窗", "飘窗"],
    usage_note: "更适合小尺度的标准窗和飘窗，适合做柔和配色点缀。"
  },
  "CUR-10583399": {
    name: 'VILDPERSILJA curtains, 1 pair, white multicolor/floral pattern/with heading tape, 57x98" - IKEA',
    window_types: ["标准窗", "飘窗", "法式门窗"],
    usage_note: "花纹款更适合标准窗、飘窗和法式门窗，适合作为风格强调。"
  },
  "CUR-10539066": {
    name: 'ROSENMANDEL black-out curtains, 1 pair, dark green/with heading tape, 53x98" - IKEA',
    window_types: ["标准窗", "落地窗", "阳台门", "法式门窗"],
    usage_note: "深绿遮光款适合标准窗到法式门窗，适合需要私密感的卧室和书房。"
  },
  "CUR-00569030": {
    name: 'HAGGVECKMAL room darkening curtains, 1 pair, beige/with heading tape, 57x98" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "阳台门", "法式门窗"],
    usage_note: "暖米色遮光布帘适合落地窗、大宽窗和法式门窗，氛围更温和。"
  },
  "CUR-20583394": {
    name: 'SILVERLONN sheer curtains, 1 pair, pink/with heading tape, 57x98" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "法式门窗", "拱形窗"],
    usage_note: "柔和色纱帘适合落地窗和法式门窗，也能覆盖拱形窗的轻透方案。"
  },
  "CUR-30346750": {
    name: 'MAJGULL room darkening curtains, 1 pair, light gray, 57x98" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "阳台门", "滑门/移门", "法式门窗"],
    usage_note: "浅灰遮光布帘适合大窗、阳台门和滑门，适合现代中性空间。"
  },
  "CUR-90590999": {
    name: 'MAJGULL room darkening curtains, 1 pair, beige-yellow/with heading tape, 57x84" - IKEA',
    window_types: ["标准窗", "小窗", "飘窗", "法式门窗"],
    usage_note: "暖色遮光款更适合标准窗、小窗和飘窗，兼顾温暖感和私密性。"
  },
  "CUR-00623414": {
    name: 'MATILDA sheer curtains, 1 pair, white/with heading tape, 57x84" - IKEA',
    window_types: ["标准窗", "小窗", "飘窗", "拱形窗"],
    usage_note: "轻透基础纱帘，适合标准窗、小窗和飘窗，也适合拱形窗做基础柔光层。"
  },
  "CUR-30589885": {
    name: 'SANELA curtains, 1 pair, dark gray-turquoise/with heading tape, 55x98" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "法式门窗"],
    usage_note: "绒感布帘更适合标准窗到大宽窗的正式场景，也适合法式门窗。"
  },
  "CUR-40390733": {
    name: 'HILJA curtains, 1 pair, gray, 57x98" - IKEA',
    window_types: ["标准窗", "落地窗", "大宽窗", "法式门窗", "飘窗"],
    usage_note: "基础灰色布帘适配范围广，适合标准窗、落地窗、大宽窗和飘窗。"
  }
};

const metadataSceneAppend = [
  {
    category: "scene",
    split: "without_curtain",
    index: "13",
    title: "Empty room with sliding glass door and additional side window",
    local_path: "scenes/without_curtain/without_curtain_13_sliding_glass_door_room.jpg",
    page_url: "https://www.pexels.com/photo/empty-room-with-sliding-glass-door-18559636/",
    image_url:
      "https://images.pexels.com/photos/18559636/pexels-photo-18559636.jpeg?cs=srgb&dl=pexels-stephen-leonardi-587681991-18559636.jpg&fm=jpg",
    window_visible: "yes",
    curtain_present: "no",
    room_type: "living_room",
    source: "Pexels",
    usage_note: "Internal evaluation only; added to cover sliding glass door scenes"
  },
  {
    category: "scene",
    split: "without_curtain",
    index: "14",
    title: "Empty room with French doors and clear mullion structure",
    local_path: "scenes/without_curtain/without_curtain_14_french_doors_empty_room.jpg",
    page_url: "https://www.pexels.com/photo/empty-room-with-terracotta-floor-and-french-doors-35843912/",
    image_url:
      "https://images.pexels.com/photos/35843912/pexels-photo-35843912.jpeg?cs=srgb&dl=pexels-alexander-f-ungerer-157458816-35843912.jpg&fm=jpg",
    window_visible: "yes",
    curtain_present: "no",
    room_type: "living_room",
    source: "Pexels",
    usage_note: "Internal evaluation only; added to cover French-door scenes"
  },
  {
    category: "scene",
    split: "without_curtain",
    index: "15",
    title: "Empty room with clear bay window geometry",
    local_path: "scenes/without_curtain/without_curtain_15_bay_window_empty_room.jpg",
    page_url: "https://www.pexels.com/photo/empty-room-with-bay-window-35419418/",
    image_url:
      "https://images.pexels.com/photos/35419418/pexels-photo-35419418.jpeg?cs=srgb&dl=pexels-peter-vang-2157328093-35419418.jpg&fm=jpg",
    window_visible: "yes",
    curtain_present: "no",
    room_type: "living_room",
    source: "Pexels",
    usage_note: "Internal evaluation only; added to cover bay-window scenes"
  }
];

const sceneEvalEntries = [
  {
    scene_id: "without_curtain_01_aframe_centered_window",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_01_aframe_centered_window.jpg",
    expected_window_type: "落地窗",
    acceptable_window_types: ["落地窗", "大宽窗"],
    eval_enabled: true,
    note: "A-frame cabin with full-height glazed opening."
  },
  {
    scene_id: "without_curtain_02_clean_kitchen_window",
    split: "without_curtain",
    room_type: "kitchen",
    local_path: "scenes/without_curtain/without_curtain_02_clean_kitchen_window.jpg",
    expected_window_type: "标准窗",
    acceptable_window_types: ["标准窗"],
    eval_enabled: true,
    note: "Single large kitchen window."
  },
  {
    scene_id: "without_curtain_03_bedroom_large_window",
    split: "without_curtain",
    room_type: "bedroom",
    local_path: "scenes/without_curtain/without_curtain_03_bedroom_large_window.jpg",
    expected_window_type: "标准窗",
    acceptable_window_types: ["标准窗", "大宽窗"],
    eval_enabled: true,
    note: "Bedroom with one dominant large window."
  },
  {
    scene_id: "without_curtain_04_livingroom_panorama_window",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_04_livingroom_panorama_window.jpg",
    expected_window_type: "大宽窗",
    acceptable_window_types: ["大宽窗", "落地窗"],
    eval_enabled: true,
    note: "Panoramic horizontal opening."
  },
  {
    scene_id: "without_curtain_05_modern_window_wall",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_05_modern_window_wall.jpg",
    expected_window_type: "大宽窗",
    acceptable_window_types: ["大宽窗", "落地窗"],
    eval_enabled: true,
    note: "Modern window wall facing courtyard."
  },
  {
    scene_id: "without_curtain_06_bright_bedroom_window",
    split: "without_curtain",
    room_type: "bedroom",
    local_path: "scenes/without_curtain/without_curtain_06_bright_bedroom_window.jpg",
    expected_window_type: "标准窗",
    acceptable_window_types: ["标准窗"],
    eval_enabled: true,
    note: "Bedroom with centered conventional window."
  },
  {
    scene_id: "without_curtain_07_minimal_living_window",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_07_minimal_living_window.jpg",
    expected_window_type: "落地窗",
    acceptable_window_types: ["落地窗", "大宽窗"],
    eval_enabled: true,
    note: "Tall minimal opening with strong vertical proportion."
  },
  {
    scene_id: "without_curtain_08_arched_windows_room",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_08_arched_windows_room.jpg",
    expected_window_type: "拱形窗",
    acceptable_window_types: ["拱形窗", "法式门窗"],
    eval_enabled: true,
    note: "Arched top glazing above door opening."
  },
  {
    scene_id: "without_curtain_09_light_room_big_window",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_09_light_room_big_window.jpg",
    expected_window_type: "大宽窗",
    acceptable_window_types: ["大宽窗", "落地窗"],
    eval_enabled: true,
    note: "Wide primary opening with low clutter."
  },
  {
    scene_id: "without_curtain_10_rustic_small_window",
    split: "without_curtain",
    room_type: "study_room",
    local_path: "scenes/without_curtain/without_curtain_10_rustic_small_window.jpg",
    expected_window_type: "小窗",
    acceptable_window_types: ["小窗", "标准窗"],
    eval_enabled: true,
    note: "Small rustic window opening."
  },
  {
    scene_id: "without_curtain_11_minimal_large_window",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_11_minimal_large_window.jpg",
    expected_window_type: "落地窗",
    acceptable_window_types: ["落地窗", "大宽窗"],
    eval_enabled: true,
    note: "Large centered minimal opening."
  },
  {
    scene_id: "without_curtain_12_courtyard_window_room",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_12_courtyard_window_room.jpg",
    expected_window_type: "大宽窗",
    acceptable_window_types: ["大宽窗", "落地窗"],
    eval_enabled: true,
    note: "Modern courtyard-facing wide opening."
  },
  {
    scene_id: "without_curtain_13_sliding_glass_door_room",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_13_sliding_glass_door_room.jpg",
    expected_window_type: "滑门/移门",
    acceptable_window_types: ["滑门/移门", "阳台门"],
    eval_enabled: true,
    note: "Glass sliding door with exterior deck access."
  },
  {
    scene_id: "without_curtain_14_french_doors_empty_room",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_14_french_doors_empty_room.jpg",
    expected_window_type: "法式门窗",
    acceptable_window_types: ["法式门窗"],
    eval_enabled: true,
    note: "Wood mullion French doors."
  },
  {
    scene_id: "without_curtain_15_bay_window_empty_room",
    split: "without_curtain",
    room_type: "living_room",
    local_path: "scenes/without_curtain/without_curtain_15_bay_window_empty_room.jpg",
    expected_window_type: "飘窗",
    acceptable_window_types: ["飘窗"],
    eval_enabled: true,
    note: "Classic bay window geometry."
  }
];

function toCsvValue(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(","))
  ];
  return `${lines.join("\n")}\n`;
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function updateMockSkuCatalog() {
  const raw = await readFile(mockSkuJsonPath, "utf8");
  const items = JSON.parse(raw);
  const curated = items.map((item) => {
    const curatedData = curatedSkuMap[item.sku_id];
    if (!curatedData) {
      return item;
    }

    return {
      ...item,
      name: curatedData.name,
      window_types: curatedData.window_types.join(", "),
      usage_note: curatedData.usage_note
    };
  });

  await writeJson(mockSkuJsonPath, curated);
  await writeFile(mockSkuCsvPath, toCsv(curated), "utf8");
}

async function updateMetadata() {
  const raw = await readFile(metadataJsonPath, "utf8");
  const metadata = JSON.parse(raw);
  const existingPaths = new Set(metadata.map((item) => item.local_path));

  for (const scene of metadataSceneAppend) {
    if (!existingPaths.has(scene.local_path) && existsSync(path.join(datasetDir, scene.local_path))) {
      metadata.push(scene);
    }
  }

  metadata.sort((left, right) => {
    if (left.category !== right.category) return left.category.localeCompare(right.category);
    if (left.split !== right.split) return left.split.localeCompare(right.split);
    return Number(left.index) - Number(right.index);
  });

  await writeJson(metadataJsonPath, metadata);
  await writeFile(metadataCsvPath, toCsv(metadata), "utf8");
}

async function writeSceneManifest() {
  await writeJson(sceneEvalJsonPath, sceneEvalEntries);
  const csvRows = sceneEvalEntries.map((item) => ({
    ...item,
    acceptable_window_types: item.acceptable_window_types.join("|")
  }));
  await writeFile(sceneEvalCsvPath, toCsv(csvRows), "utf8");
}

async function updateReadme() {
  const readme = `# Curtain Eval Window Balanced V1

Balanced internal evaluation set focused on room scenes with visible windows.

Current counts:
- \`scenes/with_curtain\`: \`8\` scenes
- \`scenes/without_curtain\`: \`15\` scenes
- \`products/\`: \`25\` curtain product references

Use this set to compare:
- curtain insertion
- curtain replacement
- style matching
- preservation of non-edited room regions
- window-type recognition and curtain matching

Window types covered in the matching benchmark:
- 标准窗
- 落地窗
- 大宽窗
- 阳台门
- 滑门/移门
- 法式门窗
- 飘窗
- 小窗
- 拱形窗

Important files:
- \`mock_sku_catalog.json\` / \`mock_sku_catalog.csv\`: curated mock SKU catalog with window-fit tags
- \`scene_window_eval.json\` / \`scene_window_eval.csv\`: labeled window-scene benchmark for matching tests

Source note:
- IKEA public webpages and images
- Unsplash public photo pages
- Pexels public photo pages
- Internal evaluation only

Additional note:
- The \`without_curtain\` split stays biased toward cleaner compositions with visible windows.
- Some \`without_curtain\` scenes are cropped from source photos so the window remains the visual focus for evaluation.
- Scenes 13-15 were added to strengthen coverage for sliding doors, French doors, and bay windows.
`;

  await writeFile(readmePath, readme, "utf8");
}

async function main() {
  await updateMockSkuCatalog();
  await updateMetadata();
  await writeSceneManifest();
  await updateReadme();
  console.log("Dataset curation complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
