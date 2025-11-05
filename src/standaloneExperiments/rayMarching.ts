const width = 240;
const height = 180;

const canvas = document.querySelector('#canvas') as HTMLCanvasElement;
canvas.width = width;
canvas.height = height;

const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error(`No support for WebGPU`);
const context = canvas.getContext('webgpu');
if (!context) throw new Error(`No support for WebGPU`);
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format });

const shader = device.createShaderModule({
  label: 'rayMarcher',
  code: /*wgsl*/ `

        const POSITIONS = array<vec2<f32>, 4>(
            vec2(-1.0, -1.0), // Bottom-left
            vec2( 1.0, -1.0), // Bottom-right
            vec2(-1.0,  1.0), // Top-left
            vec2( 1.0,  1.0)  // Top-right
        );

        const UVS = array<vec2<f32>, 4>(
            vec2(0.0, 1.0), // Bottom-left pos
            vec2(1.0, 1.0), // Bottom-right pos
            vec2(0.0, 0.0), // Top-left pos
            vec2(1.0, 0.0)  // Top-right pos
        );

        struct LightSource {
            x: f32,
            y: f32,
            h: f32
        }

        struct MetaData {
            nrLightSources: u32,
            nrSteps: u32,
            width: u32,
            height: u32
        }

        @group(0) @binding(0) var<storage> lightSources: array<LightSource>;
        @group(0) @binding(1) var<uniform> metaData: MetaData;
        @group(0) @binding(2) var textureHeight: texture_2d<f32>;
        @group(0) @binding(3) var textureDiffuse: texture_2d<f32>;

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f
        }

        @vertex fn vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
            let triangleNr: u32 = vertexIndex / 3;
            let triangleOffset: u32 = vertexIndex % 3; 
            let pos = POSITIONS[triangleNr + triangleOffset];
            let uv = UVS[triangleNr + triangleOffset];
            var vo = VertexOutput();
            vo.pos = vec4f(pos, 0, 1);
            vo.uv = uv;
            return vo;
        }

        struct FragmentOutput {
            @location(0) color: vec4f
        }

        // some textures cannot be sampled with 'textureSample', for instance r32f or rgba32f.
        // so we use 'textureLoad' instead.
        fn myTextureSampler(texture: texture_2d<f32>, uv: vec2f) -> vec4f {
            let textureSize = textureDimensions(texture);
            let coords = vec2<i32>(uv * vec2<f32>(textureSize));
            return textureLoad(texture, coords, 0);
        }

        @fragment fn fragment(vertexOutput: VertexOutput) -> FragmentOutput {

            let height: f32 = myTextureSampler(textureHeight, vertexOutput.uv).x;
            let color: vec4f = myTextureSampler(textureDiffuse, vertexOutput.uv);

            var lightness = 1.0;
            let startPoint = vec3f(vertexOutput.uv, height + 0.01);
            for (var l: u32 = 0; l < metaData.nrLightSources; l++) {
                let lightSource = lightSources[l];
                let lightSourcePoint = vec3f(lightSource.x, lightSource.y, lightSource.h);
                let direction = lightSourcePoint - startPoint;
                for (var s: u32 = 0; s < metaData.nrSteps; s++) {
                    let wayPoint = startPoint + (f32(s) / f32(metaData.nrSteps)) * direction;
                    let terrainHeight = myTextureSampler(textureHeight, wayPoint.xy).x;
                    if (terrainHeight > wayPoint.z) {
                        lightness -= (1.0 / f32(metaData.nrLightSources));
                        break;
                    }
                }
            }


            var fo = FragmentOutput();
            fo.color = vec4f(color.xyz * lightness, 1.0);

            for (var l: u32 = 0; l < metaData.nrLightSources; l++) {
                let lightSource = lightSources[l];
                let lightSourcePoint = vec3f(lightSource.x, lightSource.y, lightSource.h);
                let direction = lightSourcePoint.xy - startPoint.xy;
                if (length(direction) < 0.01) {
                  fo.color = vec4f(0, 0, 1, 1);
                }
            }

            return fo;
        }
    `,
});

const pipeline = device.createRenderPipeline({
  vertex: {
    module: shader,
    entryPoint: `vertex`,
  },
  fragment: {
    module: shader,
    entryPoint: `fragment`,
    targets: [
      {
        format,
      },
    ],
  },
  layout: 'auto',
});

const lightSourcesData = new Float32Array([
  // x y h
  0.5, 0.5, 2.5,
  // 0.25, 0.25, 1.5,
]);
const lightSources = device.createBuffer({
  size: lightSourcesData.byteLength,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
});
device.queue.writeBuffer(lightSources, 0, lightSourcesData, 0);

const metaDataData = new Uint32Array([
  // nrLightSources, nrSteps, width, height
  lightSourcesData.length / 3,
  25,
  width,
  height,
]);
const metaData = device.createBuffer({
  size: metaDataData.byteLength,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
});
device.queue.writeBuffer(metaData, 0, metaDataData, 0);

let textureHeightData = new Float32Array(width * height);
let textureDiffuseData = new Float32Array(width * height * 4);
for (let x = 0; x < width; x++) {
  for (let y = 0; y < height; y++) {
    let height = (Math.sin(x / 25) + Math.sin(y / 25)) * 0.5 + 0.5;
    if (x > 100 && x < 120 && y > 100 && y < 120) height = 2.0;

    textureHeightData[width * y + x] = height;
    const i = (width * y + x) * 4;
    textureDiffuseData[i + 0] = height * 0.5;
    textureDiffuseData[i + 1] = 1.0 - height * 0.5;
    textureDiffuseData[i + 2] = 0.0;
    textureDiffuseData[i + 3] = 1.0;
  }
}
const textureHeight = device.createTexture({
  label: 'heightTexture',
  format: 'r32float',
  size: [width, height],
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
});
device.queue.writeTexture({ texture: textureHeight }, textureHeightData, { bytesPerRow: width * 4 }, { width, height });

const textureDiffuse = device.createTexture({
  label: 'diffuseTexture',
  format: 'rgba32float',
  size: [width, height],
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
});
device.queue.writeTexture(
  { texture: textureDiffuse },
  textureDiffuseData,
  { bytesPerRow: width * 4 * 4 },
  { width, height }
);

const bindGroup = device.createBindGroup({
  label: 'raymarchingBindgroup',
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: lightSources },
    { binding: 1, resource: metaData },
    { binding: 2, resource: textureHeight.createView({}) },
    { binding: 3, resource: textureDiffuse.createView({}) },
  ],
});

let i = 0;
function render() {
  i += 1;

  lightSourcesData[0] = 0.5 + 0.5 * Math.sin(i / 100);
  lightSourcesData[1] = 0.5;
  device!.queue.writeBuffer(lightSources, 0, lightSourcesData, 0);

  const encoder = device!.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        loadOp: 'clear',
        storeOp: 'store',
        view: context!.getCurrentTexture().createView(),
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6);
  pass.end();
  const commands = encoder.finish();
  device!.queue.submit([commands]);
}

function loop() {
  const startTime = new Date().getTime();

  render();

  const endTime = new Date().getTime();
  const timePassed = endTime - startTime;
  const timeLeft = 30.0 - timePassed;
  setTimeout(loop, timeLeft);
}

loop();
