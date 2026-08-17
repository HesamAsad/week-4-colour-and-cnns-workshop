# COMP90086 Workshop 4 — slides

Reveal.js deck covering `week4/worksheet04.ipynb`: colour spaces, image formation and diffuse
reflectance, and the step from hand-designed kernels (Workshop 3) to learned ones.

Built on the same scaffolding as the Workshop 3 deck — same theme, same layout helpers, same
keys — so the two read as one course.

## Running

Open `index.html` in a browser. Everything is self-contained and works offline: reveal.js, the
Inter webfont and MathJax are vendored locally, and the images, the CIE colour data and the CNN
weights are all embedded, so there are no network requests and no CORS problems from `file://`.

For the speaker-notes window (`S`) some browsers need a real server:

```bash
cd slides && python3 -m http.server 8000     # then open http://localhost:8000
```

## Presenting

| key | |
|---|---|
| `→` / `space` | next slide |
| `S` | speaker notes — **every content slide has them** |
| `O` | slide overview |
| `F` | fullscreen |
| `B` | blank the screen |

**Export to PDF:** open `index.html?print-pdf` in Chrome → Print → Save as PDF, Layout
*Landscape*, Margins *None*, *Background graphics* on. Interactive demos freeze at whatever
state they are in, so the PDF is a handout, not a substitute for presenting live.

## What's interactive

Nothing here is a screenshot. The colour conversions, the shading, and the **entire CNN forward
pass** are computed in the browser from the worksheet's own images.

| slide | |
|---|---|
| 4 · spectrum → three numbers | drag the peak and width; a three-primary mixture re-solves itself to stay a **metamer** of the smooth spectrum. Push it far enough and the mixture needs a negative weight — the swatch goes hatched, which is a gamut boundary |
| 6 · one image, four colour spaces | RGB / HSV / XYZ / Lab, three channels each with their true ranges, plus the round trip |
| 7 · pick a pixel | click or drag on the macaws; the pixel is reported in all four spaces at once |
| 8 · the a\*–b\* plane | L\* slider; colours outside the sRGB gamut are faded, so you see a real gamut slice |
| 9 · colour swap | R↔G in RGB vs inverting a\* in Lab, the lecture's own example |
| 13 · diffuse reflectance | light direction, intensity, reflectance and light colour, with the cos θ curve tracking alongside |
| 15 · underconstrained | R and I_L are traded with their product held fixed — the world changes, the image does not |
| 17 · which parameter is changing | the three chessboard images with a magnified inset and **click-to-reveal** answers |
| 22 · why divide by 255 | contours of the loss and the descent path; the button rescales and the zig-zag disappears |
| 23 · flatten | shuffle the 784 pixels and see that the MLP would not care |
| 25 · activations | ReLU, and a softmax whose confidence you can scale |
| 26 · a conv layer | a real learned 5×5 kernel sweeping a real MNIST digit, building its activation map |
| 28 · max pooling | 8×8 → 4×4 with every number visible and the winners highlighted |
| 30 · learned filters | the eight real first-layer kernels |
| 31 · the whole network | **the trained CNN, running live** — activation maps at both stages and the softmax bars |

## The CNN is real

`js/cnndata.js` holds the weights of the worksheet's exact architecture:

```
Conv2D(8, 5×5, relu) → MaxPool(2×2) → Conv2D(16, 5×5, relu) → MaxPool(2×2)
                     → Flatten → Dense(10, softmax)          = 5,994 trainable parameters
```

trained offline by `tools/train_cnn.py` (pure numpy, Adam, batch 100, 8 epochs on 48k images).
**Test accuracy 98.0%**, which matches the Keras run in `worksheet04_solution.ipynb` (98.3%).
`js/imaging.js` re-implements the forward pass, so slide 31 is genuinely running the network,
not replaying a recording.

To retrain, or to swap the architecture:

```bash
cd tools
curl -sSLO https://storage.googleapis.com/tensorflow/tf-keras-datasets/mnist.npz
python3 train_cnn.py            # writes cnn_weights.json
# then wrap it: window.CNN = <contents of cnn_weights.json>;  ->  js/cnndata.js
```

## Emphasis guide — what to lean on in class

| slide | emphasise |
|---|---|
| 4 · spectrum | Three integrals, and the information they throw away. Metamerism is why displays work. |
| 5 · four spaces | "Choose the space where your edit is one operation on one axis." That is the whole point. |
| 9 · colour swap | R↔G moves brightness; inverting a\* does not. Look at the shadows. |
| 10 · OpenCV traps | Hue is 0–179. Round trips are lossy. `BGR2XYZ` skips the gamma but `BGR2Lab` does not. |
| 13 · Lambertian | Camera position does not appear in the equation. That is what "diffuse" buys you. |
| 15 · underconstrained | Let the silence sit while the image refuses to change. |
| 17 · the exercise | Do not reveal until they commit. Image 3 has **two** answers. |
| 18 · edges | The hinge of the workshop: we argue for edges from physics, then watch a network find them. |
| 20 · last week vs this week | The convolution is unchanged. Only the source of the 25 numbers changed. |
| 23 · flatten | A CNN's advantage is a *constraint*, not extra capacity. |
| 24 / 29 · counting | Make them compute 784×16+16 and 5×5×8×16+16 before revealing. The bias and the input-channel factor are what people forget. |
| 29 · CNN params | `summary()` after training reports 17,984 — that includes Adam's state. The answer is 5,994. |
| 30 · learned filters | Be honest: they are *partly* edge detectors. All eight sum above zero, where Sobel sums to zero. |
| 32 · comparison | Quote errors, not accuracy: 460 vs 200 per 10,000, not 95% vs 98%. |
| 35 · take-homes | Card 4 (underconstrained ⇒ you must add an assumption) and card 8 (test set hygiene). |

## Consistency with the rest of the subject

- Notation follows **COMP90086-05-ImageFormationII**: \(I_D(x) = I_L R\,\mathbf{N}(x)\cdot\mathbf{L}\),
  the trichromatic response integrals, and the invariant/tolerant distinction.
- The "colour swap" slide is the lecture's own worked example.
- Part 3 uses **lectures 06–08**'s vocabulary: *activation map* (not "feature map" — worksheet 5
  uses the other name, and slide 26 says so explicitly), *tolerance* rather than invariance for
  pooling, and the note that Keras's `Conv2D` really computes cross-correlation, which lecture 6
  also flags.
- Slide 27 gives the output-size formula in the CS231n form \(\lfloor (W-F+2P)/S \rfloor + 1\)
  and notes that lecture 7's \(\lceil (W-F+1)/S \rceil\) is the same formula, so students who
  have seen both do not think they conflict.
- The take-home about blurring before downsampling points back at Workshop 3 and Assignment 1.
- Regularisation, data augmentation and transfer learning (lectures 7–8) are **not** on the
  slides, because worksheet 4 does not use them — a speaker note flags them as coming.
- The closing slide points forward to Workshop 5 (VGG16 filter visualisation, depthwise
  separable convolution), which opens with a parameter-counting exercise this deck prepares.

## Files

```
index.html          slide content + reveal config
css/deck.css        theme (Workshop 3's, extended for colour and network diagrams)
css/inter.css       @font-face for the vendored Inter
fonts/              Inter (Google Fonts, variable, latin + latin-ext)
js/imaging.js       colour science, Lambertian shading, CNN forward pass  (no dependencies)
js/demos.js         one function per interactive figure
js/imgdata.js       workshop images (base64) + CIE 1931 colour matching functions
js/cnndata.js       trained CNN weights + 20 MNIST test digits
assets/             QR code
tools/              scripts that regenerate imgdata.js and cnndata.js
vendor/mathjax/     MathJax 3, SVG output
reveal/             reveal.js 5.1.0
```

**Maths** is LaTeX rendered by MathJax to SVG: `\( … \)` inline, `\[ … \]` display. Add
`class="eq math"` for the boxed look. The typesetting hook re-runs on every slide change, so
maths inside dynamically built demos is picked up too.

**Colour data:** the CIE 1931 2° standard observer functions in `js/imgdata.js` are the
multi-lobe Gaussian fit from Wyman, Sloan & Shirley, *JCGT* 2013 — within ~1% of the tabulated
standard observer. `tools/make_assets.py` prints the sanity checks (peaks at 555 / 600 / 450 nm,
equal-energy white giving X = Y = Z).

## Before you present

The QR code on the title slide points at
`hesamasad.github.io/week-4-colour-and-cnns-workshop`, following the Workshop 3 naming pattern.
**That repository does not exist yet** — create it, or change the URL and regenerate:

```bash
python3 -c "import segno; segno.make('https://YOUR-URL', error='m').save(
    'assets/qr-workshop.svg', kind='svg', scale=1, border=4,
    dark='#0e1117', light='#ffffff', xmldecl=False, omitsize=True)"
```

and update the two places the URL appears in `index.html` (the `<img>` alt text and the
`.qr-url` span).

## Credit / further reading linked on the last slide

- CNN Explainer, Georgia Tech — <https://poloclub.github.io/cnn-explainer/>
- Adelson's checker-shadow illusion, MIT — <https://persci.mit.edu/gallery/checkershadow>
- *Foundations of Computer Vision*, Torralba, Isola & Freeman (MIT Press) —
  <https://visionbook.mit.edu/color.html> and `convolutional_neural_nets.html`
- CS231n, Convolutional Networks, Stanford — <https://cs231n.github.io/convolutional-networks/>
- Dumoulin & Visin, *A guide to convolution arithmetic for deep learning* —
  <https://github.com/vdumoulin/conv_arithmetic>
- Metamers demo, Brown CS123 —
  <https://cs.brown.edu/courses/cs123/archive/2020/demos/metamers/index.html>
- OpenCV colour conversions —
  <https://docs.opencv.org/4.x/de/d25/imgproc_color_conversions.html>
