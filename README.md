# Planned render steps:

```txt
        B: shipPositions ───────────────────┐                                   
               │                            │                                   
               │                            │                                   
               │                            │                                   
               ▼                            │                                   
      ┌────────────────┐                    │                                   
      │ S: waterShader │                    │                                   
      └───────┬────────┘                    │                                   
              │                             │                                   
              │                             │                                   
              │                             │                                   
              │                             │                                   
              │                             │                                   
T:diffuse  ◄──┴──►  T: heightWater ────────┐│                                   
                                           ││                                   
                                           ││                                   
                                           ││                                   
                                           ││                                   
                                           ▼▼                                   
         ▼                         ┌─────────────┐                              
                                   │S: shipShader│                              
                                   └───────┬┬────┘                              
                                           ││                                   
                            ┌──────────────┘│                                   
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
