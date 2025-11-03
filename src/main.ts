const width = 320;
const height = 240;

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

        @fragment fn fragment(vertexOutput: VertexOutput) -> FragmentOutput {

            let textureSize = textureDimensions(textureHeight);
            let coords = vec2<i32>(vertexOutput.uv * vec2<f32>(textureSize));

            let height: f32 = textureLoad(textureHeight, coords, 0).x;
            let color: vec4f = textureLoad(textureDiffuse, coords, 0);

            for (var l: u32 = 0; l < metaData.nrLightSources; l++) {
                let lightSource = lightSources[l];
                for (var s: u32 = 0; s < metaData.nrSteps; s++) {

                }
            }


            var fo = FragmentOutput();
            fo.color = vec4(height, height, height, 1.0);
            // fo.color = vec4(1, 0, 0, 1);
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
  0.5, 0.5, 1.0, 0.25, 0.25, 0.5,
]);
const lightSources = device.createBuffer({
  size: lightSourcesData.byteLength,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
});
device.queue.writeBuffer(lightSources, 0, lightSourcesData, 0);

const metaDataData = new Uint32Array([
  // nrLightSources, nrSteps, width, height
  lightSources.size / 3,
  10,
  width,
  height,
]);
const metaData = device.createBuffer({
  size: metaDataData.byteLength,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
});
device.queue.writeBuffer(metaData, 0, metaDataData, 0);

let textureHeightData = new Float32Array(width * height);
textureHeightData = textureHeightData.map((d) => Math.random());
const textureHeight = device.createTexture({
  label: 'heightTexture',
  format: 'r32float',
  size: [width, height],
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
});
device.queue.writeTexture({ texture: textureHeight }, textureHeightData, { bytesPerRow: width * 4 }, { width, height });

let textureDiffuseData = new Float32Array(width * height * 4);
textureDiffuseData = textureDiffuseData.map((_) => Math.random());
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

  lightSourcesData[0] = 0.5 + 0.25 * Math.sin(i / 100);
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
