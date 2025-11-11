import { getWebGpuContext } from './lib/utils';

/**
 * TODOs:
 * - better raymarcher: prevent self intersection, move full pixels
 * - caustic: water shader, draw from ground texture
 * - blur shadows
 * - gameplay
 */

/*****************************************************************************
 * Globals
 *****************************************************************************/

const widthPx = 240;
const heightPx = 160;
const widthM = 75;
const heightM = 50;

const ships = [
  {
    xM: widthM / 2,
    yM: heightM / 2,
    rotationRad: 0.0,
    scaleClip: 0.15,
  },
  {
    xM: (3 * widthM) / 4,
    yM: heightM / 4,
    rotationRad: Math.PI / 4,
    scaleClip: 0.1,
  },
];

const lights = [
  {
    xM: widthM / 2,
    yM: heightM / 2,
    h: 1.0,
  },
  {
    xM: widthM / 2,
    yM: heightM / 2,
    h: 5.0,
  },
];

const metaDataFloats = {
  widthM: widthM, // scene width in m
  heightM: heightM, // scene height in m
  deltaX: widthM / widthPx, // = width / nrPixelsWidth
  deltaY: heightM / heightPx, // = height / nrPixelsHeight
  deltaT: 0.05, // should not be much bigger than 0.01
};

const metaDataInts = {
  shipCount: ships.length,
  lightSourcesCount: lights.length,
  rayMarcherSteps: 100,
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

        struct MetaDataFloats {
            widthM: f32,   // scene width in m
            heightM: f32,  // scene height in m
            deltaX: f32,  // = width / nrPixelsWidth
            deltaY: f32,  // = height / nrPixelsHeight
            deltaT: f32  // should not be much bigger than 0.01
        }

        struct MetaDataInts {
            shipCount: u32,
            lightSourcesCount: u32,
            rayMarcherSteps: u32
        }

        struct Ship {
            xM: f32,
            yM: f32,
            rotationRad: f32,
            scaleClip: f32
        }

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f
        }

        struct FragmentOutput {
            @location(0) diffuseColor: vec4f,
            @location(1) vhOutput: vec4f 
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

        @group(0) @binding(0) var<uniform> metaDataFloats: MetaDataFloats;
        @group(0) @binding(1) var<uniform> metaDataInts: MetaDataInts;
        @group(0) @binding(2) var<storage, read> shipPositions: array<Ship>;
        @group(0) @binding(3) var vhTexture: texture_2d<f32>;

        fn worldCoordsToUv(worldCoords: vec2f) -> vec2f {
          return vec2f(
            worldCoords.x / metaDataFloats.widthM,
            worldCoords.y / metaDataFloats.heightM
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
            let colorMin = vec4f(24.0 / 255.0, 38.0 / 255.0, 99.0 / 255.0, 1); // vec4f(0, 0.25, 1, 1);
            let colorMax = vec4f(209.0 / 255.0, 253.0 / 255.0, 255.0 / 255.0, 1);
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

            let dx = metaDataFloats.deltaX;
            let dy = metaDataFloats.deltaY;
            let dt = metaDataFloats.deltaT;
            let width = metaDataFloats.widthM;
            let height = metaDataFloats.heightM;
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
            v2 *= 0.999;
            var h2 = h1 + dt * v2;


            // if this is a ship location, create some distortion
            for (var s: u32 = 0; s < metaDataInts.shipCount; s++) {
                let shipPosM = shipPositions[s];
                let shipPosUv = worldCoordsToUv(vec2f(shipPosM.xM, shipPosM.yM));
                let dir = vo.uv - shipPosUv;
                let dist = length(dir);
                if (dist < 0.01) {
                    h2 += 0.01;
                }
            }

            var fo = FragmentOutput();
            fo.vhOutput = vec4f(v2, h2, 0, 1.0);
            fo.diffuseColor = interpolateColor(h2);
            return fo;
        }

    `,
});

const metaDataFloatsArray = new Float32Array([
  metaDataFloats.widthM,
  metaDataFloats.heightM,
  metaDataFloats.deltaX,
  metaDataFloats.deltaY,
  metaDataFloats.deltaT,
]);
const metaDataFloatsBuffer = device.createBuffer({
  label: 'metadataFloats',
  size: metaDataFloatsArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(metaDataFloatsBuffer, 0, metaDataFloatsArray, 0);

const metaDataIntsArray = new Uint32Array([
  metaDataInts.shipCount,
  metaDataInts.lightSourcesCount,
  metaDataInts.rayMarcherSteps,
]);
const metaDataIntsBuffer = device.createBuffer({
  label: 'metadataInts',
  size: metaDataIntsArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(metaDataIntsBuffer, 0, metaDataIntsArray, 0);

const shipPosArray = new Float32Array([
  ships[0].xM,
  ships[0].yM,
  ships[0].rotationRad,
  ships[0].scaleClip,
  ships[1].xM,
  ships[1].yM,
  ships[1].rotationRad,
  ships[1].scaleClip,
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

const waterDiffuseTexture = device.createTexture({
  label: `waterDiffuseTexture`,
  format: `bgra8unorm`,
  size: [widthPx, heightPx],
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

const waterPipeline = device.createRenderPipeline({
  label: `waterPipeline`,
  layout: 'auto',
  vertex: {
    module: waterShader,
    entryPoint: `vertex`,
  },
  fragment: {
    module: waterShader,
    targets: [
      {
        format: waterDiffuseTexture.format,
      },
      {
        format: vhTexture1.format,
      },
    ],
  },
});

const waterBindGroup1 = device.createBindGroup({
  layout: waterPipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: metaDataFloatsBuffer,
    },
    { binding: 1, resource: metaDataIntsBuffer },
    {
      binding: 2,
      resource: shipPosBuffer,
    },
    {
      binding: 3,
      resource: vhTexture1.createView(),
    },
  ],
});

const waterBindGroup2 = device.createBindGroup({
  layout: waterPipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: metaDataFloatsBuffer,
    },
    { binding: 1, resource: metaDataIntsBuffer },
    {
      binding: 2,
      resource: shipPosBuffer,
    },
    {
      binding: 3,
      resource: vhTexture2.createView(),
    },
  ],
});

/*****************************************************************************
 * Ship shader
 *****************************************************************************/

const shipShader = device.createShaderModule({
  label: `shipShader`,
  code: /*wgsl*/ `
  
        struct MetaDataFloats {
            widthM: f32,   // scene width in m
            heightM: f32,  // scene height in m
            deltaX: f32,  // = width / nrPixelsWidth
            deltaY: f32,  // = height / nrPixelsHeight
            deltaT: f32,  // should not be much bigger than 0.01
        }

        struct MetaDataInts {
            shipCount: u32, 
            lightSourcesCount: u32,
            rayMarcherSteps: u32,
        }

        struct Ship {
            xM: f32,
            yM: f32,
            rotationRad: f32,
            scaleClip: f32,
        }

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f
        }

        struct FragmentOutput {
            @location(0) diffuseColor: vec4f,
            @location(1) heightMap: f32
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

        @group(0) @binding(0) var<uniform> metaDataFloats: MetaDataFloats;
        @group(0) @binding(1) var<uniform> metaDataInts: MetaDataInts;
        @group(0) @binding(2) var<storage, read> shipPositions: array<Ship>;
        @group(0) @binding(3) var vhTexture: texture_2d<f32>;
        @group(0) @binding(4) var shipTexture: texture_2d<f32>;
        @group(0) @binding(5) var shipHeightTexture: texture_2d<f32>;

        fn worldCoordsToUv(worldCoords: vec2f) -> vec2f {
          return vec2f(
            worldCoords.x / metaDataFloats.widthM,
            worldCoords.y / metaDataFloats.heightM
          );
        }

        // some textures cannot be sampled with 'textureSample', for instance r32f or rgba32f.
        // so we use 'textureLoad' instead.
        fn myTextureSampler_f32(texture: texture_2d<f32>, uv: vec2f) -> vec4f {
            let textureSize = textureDimensions(texture);
            let coords = vec2<i32>(uv * vec2<f32>(textureSize));
            return textureLoad(texture, coords, 0);
        }
        fn myTextureSampler_u32(texture: texture_2d<u32>, uv: vec2f) -> vec4<u32> {
            let textureSize = textureDimensions(texture);
            let coords = vec2<i32>(uv * vec2<f32>(textureSize));
            return textureLoad(texture, coords, 0);
        }

        fn getRotationMatrix(radsAroundX: f32, radsAroundY: f32, radsAroundZ: f32) -> mat3x3<f32> {
          let rx = mat3x3(
            1, 0, 0,
            0, cos(radsAroundX), -sin(radsAroundX),
            0, sin(radsAroundX), cos(radsAroundX)
          );
          let ry = mat3x3(
            cos(radsAroundY), 0, sin(radsAroundY),
            0, 1, 0,
            -sin(radsAroundY), 0, cos(radsAroundY)
          );
          let rz = mat3x3(
            cos(radsAroundZ), - sin(radsAroundZ), 0,
            sin(radsAroundZ), cos(radsAroundZ), 0,
            0, 0, 1
          );
          return rx * ry * rz;
        }

        fn getShipH(shipPosWorldX: f32, shipPosWorldY: f32) -> f32 {
          let shipPosUv = worldCoordsToUv(vec2f(shipPosWorldX, shipPosWorldY));
          let h = myTextureSampler_f32(vhTexture, shipPosUv).y;
          return h;
        }

        fn getShipPosRotation(shipPosWorldX: f32, shipPosWorldY: f32) -> vec2f {
          let shipPosUv = worldCoordsToUv(vec2f(shipPosWorldX, shipPosWorldY));
          let h = myTextureSampler_f32(vhTexture, shipPosUv).y;
          let h_yp = myTextureSampler_f32(vhTexture, shipPosUv + vec2f(0, metaDataFloats.deltaY / metaDataFloats.heightM)).y;
          let h_xp = myTextureSampler_f32(vhTexture, shipPosUv + vec2f(metaDataFloats.deltaX / metaDataFloats.heightM, 0)).y;
          let rotationXRads = atan((h_yp - h) / metaDataFloats.deltaY);
          let rotationYRads = atan((h_xp - h) / metaDataFloats.deltaX);
          return vec2f(rotationXRads, rotationYRads);
        }

        @vertex fn vertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
            let triangleNr: u32 = vertexIndex / 3;
            let triangleOffset: u32 = vertexIndex % 3; 
            let pos = POSITIONS[triangleNr + triangleOffset];
            let uv = UVS[triangleNr + triangleOffset];

            // ship world pos
            let ship = shipPositions[instanceIndex + 0 * metaDataInts.shipCount];
            let h = getShipH(ship.xM, ship.yM);
            let shipWorldPos = vec3f(ship.xM, ship.yM, h);

            // initial vertex pos
            let vPosClip = vec3f(pos, h);

            // scale
            let scaledClip = vec3f(vPosClip.xy * ship.scaleClip, h);

            // rotate
            let rotationXY = getShipPosRotation(ship.xM, ship.yM) * 4.0;  // exaggerate rotation due to waves
            let rotationZ = ship.rotationRad;
            let rotationMatrix = getRotationMatrix(rotationXY.x, rotationXY.y, rotationZ);
            let rotated = rotationMatrix * scaledClip;

            // perspective 
            let projected = rotated / (1.0 - rotated.z);

            // translate
            let translated = vec3f(
              projected.x + 2.0 * ship.xM / metaDataFloats.widthM - 1.0,
              projected.y - 2.0 * ship.yM / metaDataFloats.heightM + 1.0,
              projected.z
            );



            var o = VertexOutput();
            o.pos = vec4f(translated.xy, 1.0, 1.0);
            o.uv = uv;
            return o;
        }

        @fragment fn fragment(vo: VertexOutput) -> FragmentOutput {
            let shipColor = myTextureSampler_f32(shipTexture, vo.uv);
            let shipHeight = myTextureSampler_f32(shipHeightTexture, vo.uv).x;
            // let waterHeight = myTextureSampler_f32(vhTexture, vo.uv).y;
            var fo = FragmentOutput();
            fo.diffuseColor = shipColor;
            fo.heightMap = shipHeight;
            return fo;
        }
  `,
});

const shipImgResponse = await fetch('./ship.png');
const blob = await shipImgResponse.blob();
const shipBitmap = await createImageBitmap(blob, { resizeHeight: 100, resizeWidth: 100 });
const shipTexture = device.createTexture({
  label: 'shipTexture',
  format: 'rgba8unorm',
  size: [100, 100],
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
});
device.queue.copyExternalImageToTexture({ source: shipBitmap }, { texture: shipTexture }, { width: 100, height: 100 });

const shipHeightImgResponse = await fetch('./shipHeightBlurred.png');
const heightBlob = await shipHeightImgResponse.blob();
const shipHeightBitmap = await createImageBitmap(heightBlob, { resizeHeight: 100, resizeWidth: 100 });
const shipHeightTexture = device.createTexture({
  label: 'shipHeightTexture',
  format: 'rgba8unorm',
  size: [100, 100],
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
});
device.queue.copyExternalImageToTexture(
  { source: shipHeightBitmap },
  { texture: shipHeightTexture },
  { width: 100, height: 100 }
);

const allRockingShipsHeightTexture = device.createTexture({
  format: 'r32float',
  size: [widthPx, heightPx],
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

const waterAndShipsDiffuseTexture = device.createTexture({
  label: `waterAndShipDiffuseTexture`,
  format: `bgra8unorm`,
  size: [widthPx, heightPx],
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

const shipPipeline = device.createRenderPipeline({
  label: `shipsPipeline`,
  layout: 'auto',
  vertex: {
    module: shipShader,
    entryPoint: `vertex`,
  },
  fragment: {
    module: shipShader,
    targets: [
      {
        format: waterAndShipsDiffuseTexture.format,
        blend: {
          color: {
            operation: 'add',
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha',
          },
          alpha: {
            operation: 'add',
            srcFactor: 'one', // or 'src-alpha'
            dstFactor: 'one-minus-src-alpha', // or 'zero'
          },
        },
      },
      {
        format: allRockingShipsHeightTexture.format,
      },
    ],
  },
});

const shipBindGroup1 = device.createBindGroup({
  label: 'shipBindGroup1',
  layout: shipPipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: metaDataFloatsBuffer,
    },
    {
      binding: 1,
      resource: metaDataIntsBuffer,
    },
    {
      binding: 2,
      resource: shipPosBuffer,
    },
    {
      binding: 3,
      resource: vhTexture1.createView(),
    },
    {
      binding: 4,
      resource: shipTexture.createView(),
    },
    {
      binding: 5,
      resource: shipHeightTexture.createView(),
    },
  ],
});

const shipBindGroup2 = device.createBindGroup({
  label: 'shipBindGroup2',
  layout: shipPipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: metaDataFloatsBuffer,
    },
    {
      binding: 1,
      resource: metaDataIntsBuffer,
    },
    {
      binding: 2,
      resource: shipPosBuffer,
    },
    {
      binding: 3,
      resource: vhTexture2.createView(),
    },
    {
      binding: 4,
      resource: shipTexture.createView(),
    },
    {
      binding: 5,
      resource: shipHeightTexture.createView(),
    },
  ],
});

/*****************************************************************************
 * Ray marcher
 *****************************************************************************/

const rayMarchShader = device.createShaderModule({
  label: 'rayMarchShader',
  code: /*wgsl*/ `


        struct MetaDataFloats {
            widthM: f32,   // scene width in m
            heightM: f32,  // scene height in m
            deltaX: f32,  // = width / nrPixelsWidth
            deltaY: f32,  // = height / nrPixelsHeight
            deltaT: f32,  // should not be much bigger than 0.01
        }

        struct MetaDataInts {
            shipCount: u32,
            lightSourcesCount: u32,
            rayMarcherSteps: u32
        }

        struct Light {
            xM: f32,
            yM: f32,
            h: f32,
        }

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f
        }

        struct FragmentOutput {
            @location(0) color: vec4f
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

        @group(0) @binding(0) var<uniform> metaDataFloats: MetaDataFloats;
        @group(0) @binding(1) var<uniform> metaDataInts: MetaDataInts;
        @group(0) @binding(2) var shipHeightTexture: texture_2d<f32>;
        @group(0) @binding(3) var diffuseTexture: texture_2d<f32>;
        @group(0) @binding(4) var<storage> lightSources: array<Light>;
        @group(0) @binding(5) var waterHeightTexture: texture_2d<f32>;

        // some textures cannot be sampled with 'textureSample', for instance r32f or rgba32f.
        // so we use 'textureLoad' instead.
        fn myTextureSampler(texture: texture_2d<f32>, uv: vec2f) -> vec4f {
            let textureSize = textureDimensions(texture);
            let coords = vec2<i32>(uv * vec2<f32>(textureSize));
            return textureLoad(texture, coords, 0);
        }

        @vertex fn vertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
            let triangleNr: u32 = vertexIndex / 3;
            let triangleOffset: u32 = vertexIndex % 3; 
            let pos = POSITIONS[triangleNr + triangleOffset];
            let uv = UVS[triangleNr + triangleOffset];
            var vo = VertexOutput();
            vo.pos = vec4f(pos, 0, 1);
            vo.uv = uv;
            return vo;
        }

        fn getTerrainHeight(uv: vec2f) -> f32 {
          let shipHeight: f32 = myTextureSampler(shipHeightTexture, uv).x;
          let waterHeight: f32 = myTextureSampler(waterHeightTexture, uv).y;
          return (shipHeight + waterHeight);
        }

        @fragment fn fragment(vo: VertexOutput) -> FragmentOutput {

            let height: f32 = getTerrainHeight(vo.uv);
            let color: vec4f = myTextureSampler(diffuseTexture, vo.uv);

            /*------ All values in pixels ---------*/
            let widthPx = metaDataFloats.widthM / metaDataFloats.deltaX;
            let heightPx = metaDataFloats.heightM / metaDataFloats.deltaY;

            let maxTravelDistance = 200.0;
            var lightnessTotal = 0.0;
            let targetPoint = vec3f(vo.uv.x * widthPx, vo.uv.y * heightPx, height);
            for (var l: u32 = 0; l < metaDataInts.lightSourcesCount; l++) {
                let lightSource = lightSources[l];
                let lightSourcePoint = vec3f(lightSource.xM / metaDataFloats.deltaX, lightSource.yM / metaDataFloats.deltaY, lightSource.h);
                let direction = targetPoint - lightSourcePoint;
                let maxDist = max(abs(direction.x), abs(direction.y));
                var distanceTraveled = length(direction);
                if (maxDist > 0.0) {
                    let delta = direction / maxDist;
                    for (var i: u32 = 0; i < u32(maxDist); i++) {
                        let wayPoint = lightSourcePoint + f32(i) * delta;
                        let terrainHeight = getTerrainHeight(vec2f(wayPoint.x / widthPx, wayPoint.y / heightPx));
                        if (terrainHeight > wayPoint.z) {
                          distanceTraveled = maxTravelDistance;
                          break;
                        }
                    }
                }
                let lightnessDecayed = (maxTravelDistance - distanceTraveled) / maxTravelDistance;
                lightnessTotal += lightnessDecayed * lightnessDecayed;
            }

            var fo = FragmentOutput();
            fo.color = vec4f(color.xyz * lightnessTotal, 1.0);
            /*---------------*/

            for (var l: u32 = 0; l < metaDataInts.lightSourcesCount; l++) {
                let lightSource = lightSources[l];
                let lightSourcePoint = vec3f(lightSource.xM / metaDataFloats.deltaX, lightSource.yM / metaDataFloats.deltaY, lightSource.h);
                let direction = targetPoint.xy - lightSourcePoint.xy;
                if (length(direction) < 2.5) {
                  fo.color = vec4f(0, 0, 1, 1);
                }
            }

            return fo;
        }
  `,
});

const rayMarcherPipeline = device.createRenderPipeline({
  label: `rayMarcherPipeline`,
  layout: 'auto',
  vertex: {
    module: rayMarchShader,
    entryPoint: `vertex`,
  },
  fragment: {
    module: rayMarchShader,
    entryPoint: `fragment`,
    targets: [
      {
        format,
      },
    ],
  },
});

const lightSourcesArray = new Float32Array([
  lights[0].xM,
  lights[0].yM,
  lights[0].h,
  lights[1].xM,
  lights[1].yM,
  lights[1].h,
]);
const lightSourcesBuffer = device.createBuffer({
  label: `lightSourcesBuffer`,
  size: lightSourcesArray.byteLength,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
});
device.queue.writeBuffer(lightSourcesBuffer, 0, lightSourcesArray, 0);

const rayMarcherBindGroup = device.createBindGroup({
  label: `rayMarcherBindGroup`,
  layout: rayMarcherPipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: metaDataFloatsBuffer,
    },
    {
      binding: 1,
      resource: metaDataIntsBuffer,
    },
    {
      binding: 2,
      resource: allRockingShipsHeightTexture.createView(),
    },
    {
      binding: 3,
      resource: waterAndShipsDiffuseTexture.createView(),
    },
    {
      binding: 4,
      resource: lightSourcesBuffer,
    },
    {
      binding: 5,
      resource: vhTexture1.createView(),
    },
  ],
});

/*****************************************************************************
 * Render loop
 *****************************************************************************/

let i = 0;
function render() {
  i += 1;

  // updating buffers

  shipPosArray[0] = 0.5 * widthM * Math.cos(i / 100) + widthM / 2;
  device.queue.writeBuffer(shipPosBuffer, 0, shipPosArray, 0);
  lightSourcesArray[0] = 0.5 * widthM + (Math.cos(i / 100) * widthM) / 8;
  lightSourcesArray[1] = 0.5 * heightM + (Math.sin(i / 100) * heightM) / 8;
  lightSourcesArray[4] = 0.5 * heightM + (Math.sin(0.5 + i / 80) * heightM) / 8;
  device.queue.writeBuffer(lightSourcesBuffer, 0, lightSourcesArray, 0);

  // water rendering

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    label: `waterRenderPass`,
    colorAttachments: [
      {
        loadOp: 'clear',
        storeOp: 'store',
        view: waterAndShipsDiffuseTexture.createView(),
      },
      {
        loadOp: 'load',
        storeOp: 'store',
        view: i % 2 === 0 ? vhTexture2.createView() : vhTexture1.createView(),
      },
    ],
  });
  pass.setPipeline(waterPipeline);
  pass.setBindGroup(0, i % 2 === 0 ? waterBindGroup1 : waterBindGroup2);
  pass.draw(6);
  pass.end();
  const command = encoder.finish();

  // ship rendering

  const encoder2 = device.createCommandEncoder();
  const pass2 = encoder2.beginRenderPass({
    label: `shipsRenderPass`,
    colorAttachments: [
      {
        loadOp: 'load',
        storeOp: 'store',
        view: waterAndShipsDiffuseTexture.createView(),
      },
      {
        loadOp: 'load',
        storeOp: 'store',
        view: allRockingShipsHeightTexture.createView(),
      },
    ],
  });
  pass2.setPipeline(shipPipeline);
  pass2.setBindGroup(0, i % 2 === 0 ? shipBindGroup2 : shipBindGroup1);
  pass2.draw(6, metaDataInts.shipCount);
  pass2.end();
  const command2 = encoder2.finish();

  // light rendering

  const encoder3 = device.createCommandEncoder();
  const pass3 = encoder3.beginRenderPass({
    colorAttachments: [
      {
        loadOp: 'clear',
        storeOp: 'store',
        view: context.getCurrentTexture().createView(),
      },
    ],
  });
  pass3.setPipeline(rayMarcherPipeline);
  pass3.setBindGroup(0, rayMarcherBindGroup);
  pass3.draw(6);
  pass3.end();
  const command3 = encoder3.finish();

  device.queue.submit([command, command2, command3]);
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
