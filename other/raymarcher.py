#%% globals
import numpy as np
import matplotlib.pyplot as plt


nrRayMarcherSteps = 50
width = height = 100
lightSources = [{
    "x": 10,
    "y": 10,
    "h": 1.5
}, {
    "x": 90,
    "y": 20,
    "h": 0.5
}]


field = np.zeros((width, height))
field[40:60, 40:60] = 1.0
color = np.zeros((width, height))

#%% original implementation

"""
    var lightness = 1.0;
    let startPoint = vec3f(vo.uv, height + 0.01);
    for (var l: u32 = 0; l < metaDataInts.lightSourcesCount; l++) {
        let lightSource = lightSources[l];
        let lightSourcePoint = vec3f(lightSource.xM / metaDataFloats.widthM, lightSource.yM / metaDataFloats.heightM, lightSource.h);
        let direction = lightSourcePoint - startPoint;
        for (var s: u32 = 0; s < metaDataInts.rayMarcherSteps; s++) {
            let wayPoint = startPoint + (f32(s) / f32(metaDataInts.rayMarcherSteps)) * direction;
            let terrainHeight = getTerrainHeight(wayPoint.xy);
            if (terrainHeight > wayPoint.z) {
                lightness -= (1.0 / f32(metaDataInts.lightSourcesCount));
                break;
            }
        }
    }
    lightness = max(lightness, 0.2);
"""

def getTerrainHeight(pos):
    r = np.int(pos[0])
    c = np.int(pos[1])
    return field[r, c]

operations = 0
for x in range(100):
    for y in range(100):
        lightness = 1.0
        startPoint = np.array([x, y, field[x, y]])
        for lightSource in lightSources:
            lightSourcePoint = np.array([lightSource['x'], lightSource['y'], lightSource['h']])
            direction = lightSourcePoint - startPoint
            for step in range(nrRayMarcherSteps):
                operations += 1
                wayPoint = startPoint + step / nrRayMarcherSteps * direction
                terrainHeight = getTerrainHeight(wayPoint)
                if terrainHeight > wayPoint[2]:
                    lightness -= 1.0 / len(lightSources)
                    break
        color[x, y] = lightness


plt.imshow(color) 
print(operations)

#%%  slight optimization
field = np.zeros((width, height))
field[40:60, 40:60] = 1.0
color = np.zeros((width, height))


def length(arr):
    return np.sum(arr * arr)

operations = 0
for x in range(100):
    for y in range(100):
        lightness = 1.0
        startPoint = np.array([x, y, field[x, y]])
        for lightSource in lightSources:
            lightSourcePoint = np.array([lightSource['x'], lightSource['y'], lightSource['h']])
            direction = lightSourcePoint - startPoint
            wayPoint = startPoint
            delta = 1.0 / nrRayMarcherSteps * direction
            if np.max(np.abs(delta)) < 1.0:
                delta = delta / np.max(np.abs(delta))
            for step in range(nrRayMarcherSteps):
                operations += 1
                wayPoint = wayPoint + delta
                if 0 > wayPoint[0] or 100 <= wayPoint[0] or 0 > wayPoint[1] or 100 <= wayPoint[1]:
                    break
                terrainHeight = getTerrainHeight(wayPoint)
                if terrainHeight > wayPoint[2]:
                    lightness -= 1.0 / len(lightSources)
                    break
        color[x, y] = lightness


plt.imshow(color)      
print(operations)


#%%
