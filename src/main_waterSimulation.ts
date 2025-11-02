


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
context?.configure({ device, format });










const waterComputeShader = device.createShaderModule({
    label: 'water simulation',
    code: /*wgsl*/`
    
        @group(0) @binding(0) var<storage, read> v1: array<f32>;
        @group(0) @binding(1) var<storage, read> h1: array<f32>;
        @group(0) @binding(2) var<storage, read_write> v2: array<f32>;
        @group(0) @binding(3) var<storage, read_write> h2: array<f32>;

        struct ImageSize {
            width: u32,
            height: u32
        }
        struct Deltas {
            dt: f32, // dt mustn't be much bigger than 0.001 for numerical stability
            dx: f32,
            dy: f32
        }
        @group(1) @binding(0) var<uniform> imageSize: ImageSize;
        @group(1) @binding(1) var<uniform> deltas: Deltas;

        fn arrayIndex(x: u32, y: u32) -> u32 {
            return y * imageSize.width + x;
        }

        @compute  @workgroup_size(1) fn comp(@builtin(global_invocation_id) id: vec3u) {
            
            let dt = deltas.dt;
            let dx = deltas.dx;
            let dy = deltas.dy;

            let x = id.x;
            let y = id.y;
            v2[arrayIndex(x, y)] = v1[arrayIndex(x, y)] + dt * ( h1[arrayIndex(x+1,y)] + h1[arrayIndex(x-1,y)] + h1[arrayIndex(x,y+1)] + h1[arrayIndex(x,y-1)] - 4.0 * h1[arrayIndex(x,y)] ) / (dx * dy);
            v2[arrayIndex(x, y)] *= 0.99;
            h2[arrayIndex(x, y)] = h1[arrayIndex(x, y)] + dt * v2[arrayIndex(x, y)];
        }
    `
})

const pipeline = device.createComputePipeline({
    layout: 'auto',
    label: 'water simulation',
    compute: {
        module: waterComputeShader,
    }
});


const v = new Float32Array(width * height);
const h = new Float32Array(width * height);
h[Math.floor(width * height / 2 + width / 2)] = 0.5;

const vBuffer1 = device.createBuffer({
    label: 'v1',
    size: v.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
});
const hBuffer1 = device.createBuffer({
    label: 'h1',
    size: h.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
});
const vBuffer2 = device.createBuffer({
    label: 'v2',
    size: v.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
});
const hBuffer2 = device.createBuffer({
    label: 'h2',
    size: h.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
});
device.queue.writeBuffer(vBuffer1, 0, v, 0);
device.queue.writeBuffer(hBuffer1, 0, h, 0);
device.queue.writeBuffer(vBuffer2, 0, v, 0);
device.queue.writeBuffer(hBuffer2, 0, h, 0);

const bindGroup1 = device.createBindGroup({
    label: 'water bindgroup1',
    entries: [{
        binding: 0,
        resource: vBuffer1,
    }, {
        binding: 1,
        resource: hBuffer1,
    }, {
        binding: 2,
        resource: vBuffer2,
    }, {
        binding: 3,
        resource: hBuffer2
    }],
    layout: pipeline.getBindGroupLayout(0)
});

const bindGroup2 = device.createBindGroup({
    label: 'water bindgroup2',
    entries: [{
        binding: 0,
        resource: vBuffer2,
    }, {
        binding: 1,
        resource: hBuffer2,
    }, {
        binding: 2,
        resource: vBuffer1,
    }, {
        binding: 3,
        resource: hBuffer1
    }],
    layout: pipeline.getBindGroupLayout(0)
});

const imageSizeData = new Uint32Array([width, height]);
const imageSizeBuffer = device.createBuffer({
    label: 'imageSizeUniform',
    size: imageSizeData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const dt = 0.001;
const dx = 1.0 / width;
const dy = 1.0 / height;
const deltasData = new Float32Array([dt, dx, dy]);
const deltaBuffer = device.createBuffer({
    label: 'deltasUniform',
    size: deltasData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});
device.queue.writeBuffer(imageSizeBuffer, 0, imageSizeData, 0);
device.queue.writeBuffer(deltaBuffer, 0, deltasData, 0);
const metaDataBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(1),
    entries: [{
        binding: 0,
        resource: imageSizeBuffer,
    }, {
        binding: 1,
        resource: deltaBuffer
    }]
})












const displayBufferShader = device.createShaderModule({
    label: 'display buffer',
    code: /*wgsl*/`

        
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

        const WIDTH = 320;
        const HEIGHT = 240;

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f,
        }

        @group(0) @binding(0) var<storage, read> data: array<f32>;

        fn getArrayIndex(x: u32, y: u32) -> u32 {
            return y * WIDTH + x;
        }

        @vertex fn vertex(
            @builtin(vertex_index) vertexIndex: u32, 
            @builtin(instance_index) instanceIndex: u32
        ) -> VertexOutput {
      
            let triangleNr: u32 = vertexIndex / 3;
            let triangleOffset: u32 = vertexIndex % 3; 
            let pos = POSITIONS[triangleNr + triangleOffset];
            let uv = UVS[triangleNr + triangleOffset];

            var output = VertexOutput();
            output.pos = vec4f(pos, 0, 1);
            output.uv = uv;
            
            return output;
        }

        @fragment fn fragment(vOut: VertexOutput) -> @location(0) vec4f {
            let x = u32(f32(WIDTH) * vOut.uv[0]);
            let y = u32(f32(HEIGHT) * vOut.uv[1]);
            let i = getArrayIndex(x, y);
            let val = data[getArrayIndex(x, y)] * 10.0;
            return vec4f(val, val, val, 1);
        }

    `
});

const displayPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
        module: displayBufferShader,
        entryPoint: 'vertex',
    },
    fragment: {
        module: displayBufferShader,
        entryPoint: 'fragment',
        targets: [{format}]
    }
});

const displayBindGroup = device.createBindGroup({
    layout: displayPipeline.getBindGroupLayout(0),
    entries: [{
        binding: 0,
        resource: hBuffer1
    }]
});











let i = 0;
function calc() {
    i += 1;

    const encoder = device!.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    if (i % 2 == 0) {
        pass.setBindGroup(0, bindGroup1);
    } else {
        pass.setBindGroup(0, bindGroup2);
    }
    pass.setBindGroup(1, metaDataBindGroup);
    pass.dispatchWorkgroups(width, height);
    pass.end();
    const encoded = encoder.finish();

    const encoder2 = device!.createCommandEncoder();
    const pass2 = encoder2.beginRenderPass({
        colorAttachments: [{
            loadOp: 'load',
            storeOp: 'store',
            view: context!.getCurrentTexture().createView(),
        }],
    });
    pass2.setPipeline(displayPipeline);
    pass2.setBindGroup(0, displayBindGroup);
    pass2.draw(6);
    pass2.end();
    const encoded2 = encoder2.finish();


    device?.queue.submit([encoded, encoded2]);

}

function loop() {
    const startTime = new Date().getTime();

    calc();

    const endTime = new Date().getTime();
    const timePassed = endTime - startTime;
    const timeLeft = 30.0 - timePassed;
    setTimeout(loop, timeLeft);
}

loop();