


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




const shader = device.createShaderModule({
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

        @group(0) @binding(0) var huvTexture: texture_2d<f32>;
        // @group(0) @binding(1) var bathyTexture: texture_2d<f32>;

    
        struct VertexOut {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f
        };

        @vertex fn vert(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
            let triangleNr: u32 = vertexIndex / 3;
            let vertexNr: u32 = vertexIndex % 3;
            let pos = POSITIONS[triangleNr + vertexNr];
            let uv = UVS[triangleNr + vertexNr];

            var vo = VertexOut();
            vo.pos = vec4f(pos, 0, 1);
            vo.uv = uv;
            return vo;
        }

        struct FragmentOut {
            @location(0) color: vec4f,
            @location(1) huv: vec4f,
        };

        @fragment fn frag(vertexOut: VertexOut) -> FragmentOut {

            // getting inputs from uniforms
            let Xtotal = 1.0;
            let Ytotal = 1.0;
            let dx = Xtotal / 320.0;
            let dy = Ytotal / 240.0;
            let dt = 0.01;
            let f = 0.523;
            let g = 9.81;
            let k = 0.01;

            // getting inputs from constants
            let H = 1.0;

            // getting inputs from previous iteration
            let coord = vec2<i32>(floor(vertexOut.uv * vec2<f32>(textureDimensions(huvTexture))));
            let coord_xp = coord + vec2(1, 0);
            let coord_yp = coord + vec2(0, 1);
            
            let huvSample: vec4f = textureLoad(huvTexture, coord, 0);
            let huvSample_xp: vec4f = textureLoad(huvTexture, coord_xp, 0);
            let huvSample_yp: vec4f = textureLoad(huvTexture, coord_yp, 0);

            let u_xp = huvSample_xp[1];
            let u = huvSample[1];
            let v_yp = huvSample_yp[2];
            let v = huvSample[2];
            let h = huvSample[0];
            let h_xp = huvSample_xp[0];
            let h_yp = huvSample_yp[0];

            // shallow water equations
            let h_tp = - H * ((u_xp - u)/dx + (v_yp - v)/dy) * dt + h;
            let u_tp = (-g * (h_xp - h)/dx - k*u + f*v) * dt + u;
            let v_tp = (-g * (h_yp - h)/dy - k*v - f*u) * dt + v;

            // output
            var fragOut = FragmentOut();
            fragOut.huv = vec4f(h_tp, u_tp, v_tp, 1.0);
            fragOut.color = vec4f(h_tp, h_tp, h_tp, 1.0);
            return fragOut;
        }

    `
});

const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {module: shader, entryPoint: 'vert'},
    fragment: {module: shader, entryPoint: 'frag', targets: [{format}, {format: 'rgba32float'}]},
});



const initialHuvData = new Float32Array(4 * width * height);
initialHuvData[4 * width * height / 2 + 4 * width / 2] = 10.0;
const huvTexture1 = device.createTexture({
    label: 'huv1',
    format: 'rgba32float',
    size: [width, height],
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
});
const huvTexture2 = device.createTexture({
    label: 'huv2',
    format: 'rgba32float',
    size: [width, height],
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
});
device.queue.writeTexture({texture: huvTexture1}, initialHuvData, {bytesPerRow: 4 * 4 * width}, {width, height});
device.queue.writeTexture({texture: huvTexture2}, initialHuvData, {bytesPerRow: 4 * 4 * width}, {width, height});
const bindGroup1 = device.createBindGroup({
    label: 'bindGroup1',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{
        binding: 0,
        resource: huvTexture1
    }
    //     binding: 1,
    //     resource: bathymetryTexture,
    // }
    ]
});
const bindGroup2 = device.createBindGroup({
    label: 'bindGroup2',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{
        binding: 0,
        resource: huvTexture2
    }
    //     binding: 1,
    //     resource: bathymetryTexture,
    // }
    ]
});


let i = 0;
function onRender() {
    i += 1;
    const encoder = device!.createCommandEncoder({label: 'swe encoder'});

    if (i % 2 == 0) {
        const pass = encoder.beginRenderPass({
            label: 'swe pass 1->2',
            colorAttachments: [{
                loadOp: 'load',
                storeOp: 'store',
                view: context!.getCurrentTexture().createView()
            }, {
                loadOp: 'load',
                storeOp: 'store',
                view: huvTexture2.createView()
            }]
        })
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup1);
        pass.draw(6);
        pass.end();
    } else {
        const pass = encoder.beginRenderPass({
            label: 'swe pass 2->1',
            colorAttachments: [{
                loadOp: 'load',
                storeOp: 'store',
                view: context!.getCurrentTexture().createView()
            }, {
                loadOp: 'load',
                storeOp: 'store',
                view: huvTexture1.createView()
            }]
        })
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup2);
        pass.draw(6);
        pass.end();
    }

    const encodedPass = encoder.finish({});
    device!.queue.submit([encodedPass]);
}

function loop() {
    const startTime = new Date().getTime();

    onRender();

    const endTime = new Date().getTime();
    const timeLeft = 30.0 - (endTime - startTime);
    setTimeout(loop, timeLeft);
}

loop();