"""Train the worksheet's exact CNN in pure numpy, then export the weights as JSON.

Architecture (worksheet04.ipynb section 3):
    Conv2D(8, 5x5, relu, valid)  -> 24x24x8
    MaxPooling2D(2x2, stride 2)  -> 12x12x8
    Conv2D(16, 5x5, relu, valid) -> 8x8x16
    MaxPooling2D(2x2, stride 2)  -> 4x4x16
    Flatten                      -> 256
    Dense(10, softmax)

Adam, batch 100, sparse categorical cross-entropy — same as Keras.
"""
import json
import numpy as np

rng = np.random.default_rng(0)
d = np.load('mnist.npz')
Xtr = d['x_train'].astype(np.float32) / 255.0
ytr = d['y_train'].astype(np.int64)
Xte = d['x_test'].astype(np.float32) / 255.0
yte = d['y_test'].astype(np.int64)

# ---------------------------------------------------------------- helpers

def im2col(x, k):
    """x: (N,H,W,C) -> (N, OH, OW, k*k*C) patches for a valid k x k conv."""
    N, H, W, C = x.shape
    OH, OW = H - k + 1, W - k + 1
    s = x.strides
    patches = np.lib.stride_tricks.as_strided(
        x, shape=(N, OH, OW, k, k, C),
        strides=(s[0], s[1], s[2], s[1], s[2], s[3]), writeable=False)
    return patches.reshape(N, OH, OW, k * k * C)


def conv_fwd(x, W, b, k):
    """W: (k*k*Cin, Cout)."""
    cols = im2col(x, k)                      # (N,OH,OW,k*k*Cin)
    out = cols @ W + b
    return out, cols


def conv_bwd(dout, cols, W, x_shape, k):
    N, H, WD, C = x_shape
    OH, OW = H - k + 1, WD - k + 1
    dW = cols.reshape(-1, cols.shape[-1]).T @ dout.reshape(-1, dout.shape[-1])
    db = dout.reshape(-1, dout.shape[-1]).sum(0)
    dcols = (dout @ W.T).reshape(N, OH, OW, k, k, C)
    dx = np.zeros(x_shape, dtype=np.float32)
    for i in range(k):                       # scatter-add the overlapping patches
        for j in range(k):
            dx[:, i:i + OH, j:j + OW, :] += dcols[:, :, :, i, j, :]
    return dx, dW, db


def maxpool_fwd(x):
    N, H, W, C = x.shape
    r = x.reshape(N, H // 2, 2, W // 2, 2, C).transpose(0, 1, 3, 2, 4, 5)
    r = r.reshape(N, H // 2, W // 2, 4, C)
    idx = r.argmax(3)
    out = np.take_along_axis(r, idx[:, :, :, None, :], axis=3).squeeze(3)
    return out, idx


def maxpool_bwd(dout, idx, x_shape):
    N, H, W, C = x_shape
    r = np.zeros((N, H // 2, W // 2, 4, C), dtype=np.float32)
    np.put_along_axis(r, idx[:, :, :, None, :], dout[:, :, :, None, :], axis=3)
    r = r.reshape(N, H // 2, W // 2, 2, 2, C).transpose(0, 1, 3, 2, 4, 5)
    return r.reshape(N, H, W, C)


class Adam:
    def __init__(self, params, lr=1e-3):
        self.p = params
        self.lr, self.b1, self.b2, self.eps, self.t = lr, 0.9, 0.999, 1e-7, 0
        self.m = [np.zeros_like(q) for q in params]
        self.v = [np.zeros_like(q) for q in params]

    def step(self, grads):
        self.t += 1
        for i, (p, g) in enumerate(zip(self.p, grads)):
            self.m[i] = self.b1 * self.m[i] + (1 - self.b1) * g
            self.v[i] = self.b2 * self.v[i] + (1 - self.b2) * g * g
            mh = self.m[i] / (1 - self.b1 ** self.t)
            vh = self.v[i] / (1 - self.b2 ** self.t)
            p -= self.lr * mh / (np.sqrt(vh) + self.eps)


def glorot(fan_in, fan_out, shape):
    lim = np.sqrt(6.0 / (fan_in + fan_out))
    return rng.uniform(-lim, lim, shape).astype(np.float32)


# ---------------------------------------------------------------- params
W1 = glorot(25 * 1, 25 * 8, (25 * 1, 8));  b1 = np.zeros(8, np.float32)
W2 = glorot(25 * 8, 25 * 16, (25 * 8, 16)); b2 = np.zeros(16, np.float32)
W3 = glorot(256, 10, (256, 10));            b3 = np.zeros(10, np.float32)
params = [W1, b1, W2, b2, W3, b3]
opt = Adam(params)


def forward(x, cache=False):
    z1, c1 = conv_fwd(x[..., None] if x.ndim == 3 else x, W1, b1, 5)
    a1 = np.maximum(z1, 0)
    p1, i1 = maxpool_fwd(a1)
    z2, c2 = conv_fwd(p1, W2, b2, 5)
    a2 = np.maximum(z2, 0)
    p2, i2 = maxpool_fwd(a2)
    flat = p2.reshape(len(x), -1)
    logits = flat @ W3 + b3
    logits -= logits.max(1, keepdims=True)
    e = np.exp(logits)
    prob = e / e.sum(1, keepdims=True)
    if cache:
        return prob, (c1, z1, a1, i1, p1, c2, z2, a2, i2, p2, flat)
    return prob


def train(epochs=8, bs=100, n=48000):
    Xa, ya = Xtr[:n], ytr[:n]
    Xv, yv = Xtr[n:], ytr[n:]
    for ep in range(epochs):
        perm = rng.permutation(n)
        for s in range(0, n, bs):
            idx = perm[s:s + bs]
            x = Xa[idx][..., None]
            y = ya[idx]
            prob, (c1, z1, a1, i1, p1, c2, z2, a2, i2, p2, flat) = forward(x, True)

            dlog = prob.copy()
            dlog[np.arange(len(y)), y] -= 1
            dlog /= len(y)
            dW3 = flat.T @ dlog
            db3 = dlog.sum(0)
            dflat = (dlog @ W3.T).reshape(p2.shape)
            da2 = maxpool_bwd(dflat, i2, a2.shape)
            dz2 = da2 * (z2 > 0)
            dp1, dW2, db2 = conv_bwd(dz2, c2, W2, p1.shape, 5)
            da1 = maxpool_bwd(dp1, i1, a1.shape)
            dz1 = da1 * (z1 > 0)
            _, dW1, db1 = conv_bwd(dz1, c1, W1, x.shape, 5)
            opt.step([dW1, db1, dW2, db2, dW3, db3])

        vp = np.concatenate([forward(Xv[i:i + 500][..., None]) for i in range(0, len(Xv), 500)])
        acc = (vp.argmax(1) == yv).mean()
        print(f'epoch {ep + 1}/{epochs}  val_accuracy {acc:.4f}', flush=True)


train()
tp = np.concatenate([forward(Xte[i:i + 500][..., None]) for i in range(0, len(Xte), 500)])
test_acc = (tp.argmax(1) == yte).mean()
print(f'TEST accuracy {test_acc:.4f}', flush=True)

# ------------------------------------------------- export weights + digits
# 20 test digits (two per class) that the model gets right, for the live demo
picks = []
for cls in range(10):
    cand = np.where((yte == cls) & (tp.argmax(1) == yte))[0][:2]
    picks.extend(cand.tolist())

digits = [{'label': int(yte[i]),
           'px': (Xte[i] * 255).round().astype(np.uint8).flatten().tolist()}
          for i in picks]

out = {
    'test_accuracy': float(test_acc),
    'arch': 'conv8x5x5-pool2-conv16x5x5-pool2-flatten-dense10',
    # (5,5,Cin,Cout) laid out row-major, matching Keras kernel order
    'W1': np.round(W1.reshape(5, 5, 1, 8), 4).flatten().tolist(),
    'b1': np.round(b1, 4).tolist(),
    'W2': np.round(W2.reshape(5, 5, 8, 16), 4).flatten().tolist(),
    'b2': np.round(b2, 4).tolist(),
    'W3': np.round(W3, 4).flatten().tolist(),
    'b3': np.round(b3, 4).tolist(),
    'digits': digits,
}
with open('cnn_weights.json', 'w') as f:
    json.dump(out, f, separators=(',', ':'))
print('wrote cnn_weights.json', flush=True)
