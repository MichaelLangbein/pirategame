# %%
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation


X = 60
Y = 60
T = 60
v = np.zeros((X, Y, T))
h = np.zeros((X, Y, T))
h[int(X/2), int(Y/2), 0] = 5.0
c = 1.0
dt = 0.1
dx = 1.0
dy = 1.0


def step(h, v, t):
    print(t)
    for i in range(1, X-1):
        for j in range(1, Y-1):
            v[i, j, t+1] = v[i, j, t] + \
                dt * c * c * \
                (h[i+1, j, t] + h[i-1, j, t] + h[i, j+1, t] +
                 h[i, j-1, t] - 4 * h[i, j, t]) / (dx * dy)
            v[i, j, t+1] *= 0.99
            h[i, j, t+1] = h[i, j, t] + dt * v[i, j, t+1]
    return h[:, :, t+1]


def animation(t):
    t = t-1
    if t < 0:
        return
    out = step(h, v, t)
    plt.imshow(out, vmin=-5, vmax=5)


fig = plt.figure()
ani = FuncAnimation(fig, animation, interval=60, frames=T)
ani.save("gif.gif")

# %%
