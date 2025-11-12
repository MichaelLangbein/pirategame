# Render steps:

```txt
  B: shipPositions ───────────────────┐
         │                            │
         ▼                            │
┌────────────────┐                    │
│ S: waterShader │                    │
└───────┬────────┘                    │
        │                             │
        │                             │
        │                             │
        └──►  T: heightWater ────────┐│
                 │                   ││
                 │                   ││
    ┌────────────▼────────┐          ││
    │ S: refractionShader │          ││
    └────────────┬────────┘          ▼▼
                 │           ┌─────────────┐
            ┌────┘           │S: shipShader│
            │                └───────┬┬────┘
            ▼                        ││
       T:diffuse      ┌──────────────┘│
                      │               │
                      ▼               ▼
                  T:diffuse     T:heightWaterAndShips       B:lightSources
                      │               │                      │
                      │               │                      │
                      └─────────────┐ │                      │
                                    │ │ ┌────────────────────┘
                                    │ │ │
                                 ┌──▼─▼─▼──────┐
                                 │ S:rayMarcher│
                                 └──────┬──────┘
                                        │
                                        │
                                        │
                                        │
                                        ▼
                                     Canvas
```
