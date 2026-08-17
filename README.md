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
| 4 · three numbers from a spectrum | drag the peak and width; each of X, Y, Z is drawn as the **shaded overlap area** between the light and one sensitivity curve, so the integral is something you can watch shrink |
| 5 · two lights, one colour | a smooth spectrum and a three-spike mixture solved to identical XYZ, painted as one swatch with no seam. Push it far enough and the mixture needs a negative weight, which is a gamut boundary |
| 6 · four colour spaces at once | the same photo split into RGB, HSV, XYZ and Lab side by side. Hue and the two opponent axes get their own colour maps, because they are angles and signed axes rather than intensities |
| 7 · the same colours, three shapes | the RGB cube, the HSV cylinder and the lumpy Lab solid — **one point set, three coordinate systems**, drawn as filled surfaces. Drag any of them and all three rotate together |
| 8 · so why are there so many? | a pros/cons table across RGB, HSV, YCbCr and Lab, plus two colour pairs **exactly 60 apart in RGB** whose perceived difference differs 19× |
| 9 · there and back again | one space at a time, with the true channel ranges, plus the round trip |
| 10 · pick a pixel | click or drag on the macaws; the pixel is reported in all four spaces at once |
| 11 · the a\*–b\* plane | L\* slider; a real horizontal slice through the Lab solid, with everything sRGB cannot display faded out |
| 12 · colour swap | R↔G in RGB vs inverting a\* in Lab, the lecture's own example |
| 16 · diffuse reflectance | N and L as unit arrows, N·L drawn as the **projection of L onto N**, and a falloff plot that runs past 90° so the clamp is visible |
| 18 · underconstrained | R and I_L are traded with their product held fixed — the world changes, the image does not |
| 20 · which parameter is changing | the three chessboard images with a magnified inset and **click-to-reveal** answers |
| 25 · why divide by 255 | contours of the loss and the descent path; the button rescales and the zig-zag disappears |
| 26 · flatten | shuffle all 784 pixels and watch one 3×3 neighbourhood scatter — with a verdict for each model |
| 28 · activations | ReLU, and a softmax whose confidence you can scale |
| 29 · a conv layer | a real learned 5×5 kernel sweeping a real MNIST digit, building its activation map |
| 31 · max pooling | 8×8 → 4×4 with every number visible and the winners highlighted |
| 33 · learned filters | the eight real first-layer kernels |
| 34 · the whole network | **the trained CNN, running live** — activation maps at both stages and the softmax bars |

## The CNN is real

`js/cnndata.js` holds the weights of the worksheet's exact architecture:

```
Conv2D(8, 5×5, relu) → MaxPool(2×2) → Conv2D(16, 5×5, relu) → MaxPool(2×2)
                     → Flatten → Dense(10, softmax)          = 5,994 trainable parameters
```

trained offline by `tools/train_cnn.py` (pure numpy, Adam, batch 100, 8 epochs on 48k images).
**Test accuracy 98.0%**, which matches the Keras run in `worksheet04_solution.ipynb` (98.3%).
`js/imaging.js` re-implements the forward pass, so slide 34 is genuinely running the network,
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
| 4 · three numbers | Each number is an **area**. Drag the peak slowly and let them watch the areas trade. |
| 5 · metamers | Two spectra, one colour — and the projector in this room is doing exactly this right now. |
| 6 · four spaces at once | Cover the labels on the RGB row and ask which is which. They cannot tell. That *is* the point. |
| 7 · three shapes | Lab is **not** spherical — it is rectangular like RGB. HSV is the polar one; Lab's polar form is LCh. |
| 8 · why so many | Both swatch pairs are 60 apart in RGB and 19× apart to the eye. That is the whole case against RGB distance. |
| 11 · the gamut slice | "Faded = your screen cannot show it." Not all of the faded area is even a real colour — see the notes. |
| 12 · colour swap | R↔G moves brightness; inverting a\* does not. Look at the shadows. |
| 13 · OpenCV traps | Hue is 0–179. Round trips are lossy. `BGR2XYZ` skips the gamma but `BGR2Lab` does not. |
| 16 · Lambertian | N·L is a projection, and the flat part of the curve past 90° is the max(0, ·) clamp. |
| 18 · underconstrained | Let the silence sit while the image refuses to change. |
| 20 · the exercise | Do not reveal until they commit. Image 1 is the queen's cast shadow; image 3 has **two** answers. |
| 21 · edges | The hinge of the workshop: we argue for edges from physics, then watch a network find them. |
| 23 · last week vs this week | The convolution is unchanged. Only the source of the 25 numbers changed. |
| 26 · flatten | A CNN's advantage is a *constraint*, not extra capacity — the MLP genuinely does not care. |
| 27 / 32 · counting | Make them compute 784×16+16 and 5×5×8×16+16 before revealing. The bias and the input-channel factor are what people forget. |
| 32 · CNN params | `summary()` after training reports 17,984 — that includes Adam's state. The answer is 5,994. |
| 33 · learned filters | Be honest: they are *partly* edge detectors. All eight sum above zero, where Sobel sums to zero. |
| 35 · comparison | Quote errors, not accuracy: 460 vs 200 per 10,000, not 95% vs 98%. |
| 38 · take-homes | Card 4 (underconstrained ⇒ you must add an assumption) and card 8 (test set hygiene). |

## Consistency with the rest of the subject

- Notation follows **COMP90086-05-ImageFormationII**: \(I_D(x) = I_L R\,\mathbf{N}(x)\cdot\mathbf{L}\),
  the trichromatic response integrals, and the invariant/tolerant distinction.
- The "colour swap" slide is the lecture's own worked example.
- Part 3 uses **lectures 06–08**'s vocabulary: *activation map* (not "feature map" — worksheet 5
  uses the other name, and slide 29 says so explicitly), *tolerance* rather than invariance for
  pooling, and the note that Keras's `Conv2D` really computes cross-correlation, which lecture 6
  also flags.
- Slide 30 gives the output-size formula in the CS231n form \(\lfloor (W-F+2P)/S \rfloor + 1\)
  and notes that lecture 7's \(\lceil (W-F+1)/S \rceil\) is the same formula, so students who
  have seen both do not think they conflict.
- The take-home about blurring before downsampling points back at Workshop 3 and Assignment 1.
- Regularisation, data augmentation and transfer learning (lectures 7–8) are **not** on the
  slides, because worksheet 4 does not use them — a speaker note flags them as coming.
- The colour-space comparison follows Justin Johnson's **EECS 442** lecture 4 (Michigan, slide
  credit to James Hays), including YCbCr, which the worksheet does not mention but which every
  student has used inside a JPEG.
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
