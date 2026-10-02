// Original synthetic examples. No user workflows, generated images, or credentials.
export const demoWorkflow = {
  version: 0.4,
  last_node_id: 10,
  last_link_id: 13,
  nodes: [
    { id: 1, type: 'CheckpointLoaderSimple', title: '基础模型', pos: [40, 100], size: [260, 100], mode: 0,
      inputs: [], outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }, { name: 'CLIP', type: 'CLIP', links: [2] }, { name: 'VAE', type: 'VAE', links: [10] }],
      widgets_values: ['illustration-base-v1.safetensors'], properties: { cnr_id: 'comfy-core' } },
    { id: 2, type: 'LoraLoader', title: '水彩风格 LoRA', pos: [350, 100], size: [240, 130], mode: 0,
      inputs: [{ name: 'model', type: 'MODEL', link: 1 }, { name: 'clip', type: 'CLIP', link: 2 }],
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [3] }, { name: 'CLIP', type: 'CLIP', links: [4, 5] }],
      widgets_values: ['watercolor-lines.safetensors', 0.7, 0.7], properties: { cnr_id: 'comfy-core' } },
    { id: 3, type: 'CLIPTextEncode', title: '正向提示词', pos: [650, 40], size: [280, 150], mode: 0,
      inputs: [{ name: 'clip', type: 'CLIP', link: 4 }], outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [6] }],
      widgets_values: ['A quiet train platform at blue hour, watercolor illustration, warm windows, delicate linework, cinematic composition'] },
    { id: 4, type: 'CLIPTextEncode', title: '负向提示词', pos: [650, 250], size: [280, 130], mode: 0,
      inputs: [{ name: 'clip', type: 'CLIP', link: 5 }], outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [7] }],
      widgets_values: ['blurry, oversaturated, watermark, text'] },
    { id: 5, type: 'EmptyLatentImage', title: '画布尺寸', pos: [650, 440], size: [230, 110], mode: 0,
      inputs: [], outputs: [{ name: 'LATENT', type: 'LATENT', links: [8] }], widgets_values: [1024, 768, 1] },
    { id: 6, type: 'KSampler', title: '主采样器', pos: [1000, 160], size: [250, 260], mode: 0,
      inputs: [{ name: 'model', type: 'MODEL', link: 3 }, { name: 'positive', type: 'CONDITIONING', link: 6 }, { name: 'negative', type: 'CONDITIONING', link: 7 }, { name: 'latent_image', type: 'LATENT', link: 8 }],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: [9] }], widgets_values: [20261002, 'fixed', 28, 6.5, 'euler', 'normal', 1] },
    { id: 7, type: 'VAEDecode', title: '潜空间解码', pos: [1310, 190], size: [210, 90], mode: 0,
      inputs: [{ name: 'samples', type: 'LATENT', link: 9 }, { name: 'vae', type: 'VAE', link: 10 }],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [11, 12] }], widgets_values: [] },
    { id: 8, type: 'SaveImage', title: '保存成片', pos: [1600, 100], size: [220, 180], mode: 0,
      inputs: [{ name: 'images', type: 'IMAGE', link: 11 }], outputs: [], widgets_values: ['ComfyTrace/platform'] },
    { id: 9, type: 'PreviewImage', title: '预览', pos: [1600, 350], size: [220, 180], mode: 0,
      inputs: [{ name: 'images', type: 'IMAGE', link: 12 }], outputs: [], widgets_values: [] },
  ].map((node, order) => ({ ...node, flags: {}, order, properties: node.properties ?? { cnr_id: 'comfy-core' } })),
  links: [
    [1, 1, 0, 2, 0, 'MODEL'], [2, 1, 1, 2, 1, 'CLIP'], [3, 2, 0, 6, 0, 'MODEL'],
    [4, 2, 1, 3, 0, 'CLIP'], [5, 2, 1, 4, 0, 'CLIP'], [6, 3, 0, 6, 1, 'CONDITIONING'],
    [7, 4, 0, 6, 2, 'CONDITIONING'], [8, 5, 0, 6, 3, 'LATENT'], [9, 6, 0, 7, 0, 'LATENT'],
    [10, 1, 2, 7, 1, 'VAE'], [11, 7, 0, 8, 0, 'IMAGE'], [12, 7, 0, 9, 0, 'IMAGE'],
  ],
  groups: [], config: {}, extra: { ds: { scale: 0.8, offset: [0, 0] } },
};

export const demoRevision = structuredClone(demoWorkflow);
demoRevision.nodes[1].widgets_values = ['watercolor-lines.safetensors', 0.85, 0.7];
demoRevision.nodes[2].widgets_values = ['A quiet train platform at sunrise, watercolor illustration, golden windows, delicate linework, cinematic composition'];
demoRevision.nodes[5].widgets_values = [20261002, 'fixed', 36, 7, 'dpmpp_2m', 'karras', 1];
demoRevision.nodes[0].pos = [80, 180];

export const brokenWorkflow = structuredClone(demoWorkflow);
brokenWorkflow.nodes = brokenWorkflow.nodes.filter((node) => node.id !== 2);
brokenWorkflow.nodes.find((node) => node.id === 6)!.mode = 2;

export const demoApi = {
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'illustration-base-v1.safetensors' } },
  '2': { class_type: 'CLIPTextEncode', inputs: { text: 'Watercolor train platform at blue hour', clip: ['1', 1] } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, watermark', clip: ['1', 1] } },
  '4': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 768, batch_size: 1 } },
  '5': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed: 20261002, steps: 28, cfg: 6.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
  '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
  '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'ComfyTrace/platform' } },
};

export const demoInventory = Object.fromEntries(
  [...new Set(demoWorkflow.nodes.map((node) => node.type))].map((type) => [type, {
    input: { required: type === 'CheckpointLoaderSimple' ? { ckpt_name: [['illustration-base-v1.safetensors']] }
      : type === 'LoraLoader' ? { lora_name: [['watercolor-lines.safetensors']] } : {} },
    output_node: type === 'SaveImage' || type === 'PreviewImage',
  }]),
);
