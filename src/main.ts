import { getWebGpuContext } from './lib/utils';

/**
 *
 */

/*****************************************************************************
 * Globals
 *****************************************************************************/

const widthPx = 640;
const heightPx = 480;
const widthM = 75;
const heightM = 50;


const shipPositions = [
  {
    xM: widthM / 2,
    yM: heightM / 2,
    rotation: 0.0,
  },
  {
    xM: widthM / 4,
    yM: heightM / 4,
    rotation: Math.PI,
  },
];

const metaData = {
  widthM: widthM, // scene width in m
  heightM: heightM, // scene height in m
  deltaX: widthM / widthPx, // = width / nrPixelsWidth
  deltaY: heightM / heightPx, // = height / nrPixelsHeight
  deltaT: 0.01, // should not be much bigger than 0.01
  shipCount: shipPositions.length
};


const canvas = document.querySelector('#canvas') as HTMLCanvasElement;
canvas.width = widthPx;
canvas.height = heightPx;

const { device, context, format } = await getWebGpuContext(canvas);

/*****************************************************************************
 * Water shader
 *****************************************************************************/

const waterShader = device.createShaderModule({
  code: /*wgsl*/ `

        struct MetaData {
            widthM: f32,   // scene width in m
            heightM: f32,  // scene height in m
            deltaX: f32,  // = width / nrPixelsWidth
            deltaY: f32,  // = height / nrPixelsHeight
            deltaT: f32,  // should not be much bigger than 0.01
            shipCount: f32  // only a float for consistency
        }

        struct ShipPosition {
            xM: f32,
            yM: f32,
            rotation: f32
        }

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f
        }

        struct FragmentOutput {
            @location(0) diffuseColor: vec4f,
            @location(1) huvOutput: vec4f 
        }

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

        @group(0) @binding(0) var<uniform> metaData: MetaData;
        @group(0) @binding(1) var<storage, read> shipPositions: array<ShipPosition>;
        @group(0) @binding(2) var vhTexture: texture_2d<f32>;

        fn worldCoordsToUv(worldCoords: vec2f) -> vec2f {
          return vec2f(
            worldCoords.x / metaData.widthM,
            worldCoords.y / metaData.heightM
          );
        }

        // some textures cannot be sampled with 'textureSample', for instance r32f or rgba32f.
        // so we use 'textureLoad' instead.
        fn myTextureSampler(texture: texture_2d<f32>, uv: vec2f) -> vec4f {
            let textureSize = textureDimensions(texture);
            let coords = vec2<i32>(uv * vec2<f32>(textureSize));
            return textureLoad(texture, coords, 0);
        }

        fn interpolateColor(h: f32) -> vec4f {
            let hmin = 0.0;
            let hmax = 2.0;
            let colorMin = vec4f(0, 0.25, 1, 1);
            let colorMax = vec4f(0.25, 1, 1, 1);
            let dir = colorMax - colorMin;
            let fraction = (h - hmin) / (hmax - hmin);
            let interpolated = colorMin + fraction * dir;
            return interpolated;
        }

        @vertex fn vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
            let triangleNr: u32 = vertexIndex / 3;
            let triangleOffset: u32 = vertexIndex % 3; 
            let pos = POSITIONS[triangleNr + triangleOffset];
            let uv = UVS[triangleNr + triangleOffset];
            var o = VertexOutput();
            o.pos = vec4f(pos, 0, 1);
            o.uv = uv;
            return o;
        }

        @fragment fn fragment(vo: VertexOutput) -> FragmentOutput {

            let dx = metaData.deltaX;
            let dy = metaData.deltaY;
            let dt = metaData.deltaT;
            let width = metaData.widthM;
            let height = metaData.heightM;
            let delta = worldCoordsToUv(vec2f(dx, dy));

            let vh = myTextureSampler(vhTexture, vo.uv);
            let vh_xp = myTextureSampler(vhTexture, vo.uv + vec2f(delta.x, 0));
            let vh_xm = myTextureSampler(vhTexture, vo.uv - vec2f(delta.x, 0));
            let vh_yp = myTextureSampler(vhTexture, vo.uv + vec2f(0, delta.y));
            let vh_ym = myTextureSampler(vhTexture, vo.uv - vec2f(0, delta.y));

            let v1 = vh.x;
            let h1 = vh.y;
            let h1_xp = vh_xp.y;
            let h1_xm = vh_xm.y;
            let h1_yp = vh_yp.y;
            let h1_ym = vh_ym.y;

            // water simulation
            var v2 = v1 + dt * ( h1_xp + h1_xm + h1_yp + h1_ym - 4.0 * h1 ) / (dx * dy);
            v2 *= 0.99;
            var h2 = h1 + dt * v2;


            // if this is a ship location, create some distortion
            for (var s: u32 = 0; s < u32(metaData.shipCount); s++) {
                let shipPosM = shipPositions[s];
                let shipPosUv = worldCoordsToUv(vec2f(shipPosM.xM, shipPosM.yM));
                let dir = vo.uv - shipPosUv;
                let dist = length(dir);
                if (dist < 0.01) {
                    h2 += 0.01;
                }
            }

            var fo = FragmentOutput();
            fo.huvOutput = vec4f(v2, h2, 0, 1.0);
            fo.diffuseColor = interpolateColor(h2);
            return fo;
        }

    `,
});

const metaDataArray = new Float32Array([
  metaData.widthM,
  metaData.heightM,
  metaData.deltaX,
  metaData.deltaY,
  metaData.deltaT,
  metaData.shipCount
]);
const metaDataBuffer = device.createBuffer({
  label: 'metadata',
  size: metaDataArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(metaDataBuffer, 0, metaDataArray, 0);

const shipPosArray = new Float32Array([
  shipPositions[0].xM,
  shipPositions[0].yM,
  shipPositions[0].rotation,
  shipPositions[1].xM,
  shipPositions[1].yM,
  shipPositions[1].rotation,
]);
const shipPosBuffer = device.createBuffer({
  label: 'shipPositions',
  size: shipPosArray.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(shipPosBuffer, 0, shipPosArray, 0);

const vhTexture1 = device.createTexture({
  label: 'vhTexture1',
  format: 'rgba32float',
  size: [widthPx, heightPx],
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});

const vhTexture2 = device.createTexture({
  label: 'vhTexture2',
  format: 'rgba32float',
  size: [widthPx, heightPx],
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});

const waterPipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex: {
    module: waterShader,
    entryPoint: `vertex`,
  },
  fragment: {
    module: waterShader,
    targets: [
      {
        format,
      },
      {
        format: vhTexture1.format,
      },
    ],
  },
});

const waterBindgroup1 = device.createBindGroup({
  layout: waterPipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: metaDataBuffer,
    },
    {
      binding: 1,
      resource: shipPosBuffer,
    },
    {
      binding: 2,
      resource: vhTexture1.createView(),
    },
  ],
});

const waterBindgroup2 = device.createBindGroup({
  layout: waterPipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: metaDataBuffer,
    },
    {
      binding: 1,
      resource: shipPosBuffer,
    },
    {
      binding: 2,
      resource: vhTexture2.createView(),
    },
  ],
});

let i = 0;
function render() {
  i += 1;

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        loadOp: 'clear',
        storeOp: 'store',
        view: context.getCurrentTexture().createView(), // todo: later, this will be the diffuseTexture instead
      },
      {
        loadOp: 'load',
        storeOp: 'store',
        view: i % 2 === 0 ? vhTexture2.createView() : vhTexture1.createView(),
      },
    ],
  });
  pass.setPipeline(waterPipeline);
  pass.setBindGroup(0, i % 2 === 0 ? waterBindgroup1 : waterBindgroup2);
  pass.draw(6);
  pass.end();
  const command = encoder.finish();
  device.queue.submit([command]);
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
