extends RefCounted
## Signal analysis: the measuring tools the audio tests use.
##
## You can't listen. Test structurally instead: peak, RMS, envelope shape, and a spectral
## centroid from a real FFT. Pure arithmetic over a float array, and step for step the
## measurements the web game takes of its own sounds, so a number from here and a number from
## there mean the same thing.

static func peak(samples: PackedFloat32Array) -> float:
	var top := 0.0
	for s in samples:
		var a := absf(s)
		if a > top:
			top = a
	return top


static func rms(samples: PackedFloat32Array) -> float:
	if samples.is_empty():
		return 0.0
	var sum := 0.0
	for s in samples:
		sum += s * s
	return sqrt(sum / samples.size())


static func energy(samples: PackedFloat32Array) -> float:
	var sum := 0.0
	for s in samples:
		sum += s * s
	return sum


static func has_nan(samples: PackedFloat32Array) -> bool:
	for s in samples:
		if is_nan(s) or is_inf(s):
			return true
	return false


## Largest power of two not exceeding `n`.
static func floor_pow2(n: int) -> int:
	var p := 1
	while p * 2 <= n:
		p *= 2
	return p


## In-place iterative radix-2 FFT. `re` and `im` must be the same power-of-two length.
static func fft_in_place(re: PackedFloat64Array, im: PackedFloat64Array) -> void:
	var n := re.size()
	if n <= 1:
		return
	# Bit-reversal permutation.
	var j := 0
	for i in range(1, n):
		var bit := n >> 1
		while j & bit:
			j ^= bit
			bit >>= 1
		j ^= bit
		if i < j:
			var tr := re[i]
			re[i] = re[j]
			re[j] = tr
			var ti := im[i]
			im[i] = im[j]
			im[j] = ti
	var length := 2
	while length <= n:
		var ang := -TAU / length
		var wr := cos(ang)
		var wi := sin(ang)
		var half := length >> 1
		var i := 0
		while i < n:
			var cr := 1.0
			var ci := 0.0
			for k in half:
				var a := i + k
				var b := a + half
				var tr := re[b] * cr - im[b] * ci
				var ti := re[b] * ci + im[b] * cr
				re[b] = re[a] - tr
				im[b] = im[a] - ti
				re[a] += tr
				im[a] += ti
				var ncr := cr * wr - ci * wi
				ci = cr * wi + ci * wr
				cr = ncr
			i += length
		length <<= 1


## Magnitude spectrum of the first power-of-two window of `samples`, Hann-windowed.
static func magnitude_spectrum(samples: PackedFloat32Array) -> PackedFloat64Array:
	var n := floor_pow2(samples.size())
	if n < 2:
		return PackedFloat64Array()
	var re := PackedFloat64Array()
	var im := PackedFloat64Array()
	re.resize(n)
	im.resize(n)
	for i in n:
		re[i] = samples[i] * 0.5 * (1.0 - cos(TAU * i / (n - 1)))
	fft_in_place(re, im)
	var half := n >> 1
	var mags := PackedFloat64Array()
	mags.resize(half)
	for i in half:
		mags[i] = sqrt(re[i] * re[i] + im[i] * im[i])
	return mags


## Spectral centroid in Hz — the centre of mass of the spectrum, and the number that proves the
## binding and free-pin sounds can be told apart.
static func centroid_of(mags: PackedFloat64Array, rate: float) -> float:
	if mags.is_empty():
		return 0.0
	var bin_hz := rate / (mags.size() * 2)
	var weighted := 0.0
	var total := 0.0
	for i in mags.size():
		weighted += mags[i] * i * bin_hz
		total += mags[i]
	return weighted / total if total > 0.0 else 0.0


## Frequency of the loudest bin, in Hz. DC is skipped.
static func dominant_of(mags: PackedFloat64Array, rate: float) -> float:
	if mags.is_empty():
		return 0.0
	var best := 0.0
	var best_index := 0
	for i in range(1, mags.size()):
		if mags[i] > best:
			best = mags[i]
			best_index = i
	return best_index * rate / (mags.size() * 2)


static func spectral_centroid(samples: PackedFloat32Array, rate: float) -> float:
	return centroid_of(magnitude_spectrum(samples), rate)


static func dominant_frequency(samples: PackedFloat32Array, rate: float) -> float:
	return dominant_of(magnitude_spectrum(samples), rate)


## A one-shot's envelope: { attack, duration, peak_index, peak, silent }, times in seconds.
## `threshold` is relative to the signal's own peak, so it works the same on a quiet tick and a
## loud thunk.
static func envelope(samples: PackedFloat32Array, rate: float, threshold := 0.02) -> Dictionary:
	var p := peak(samples)
	if p <= 0.0:
		return {"attack": 0.0, "duration": 0.0, "peak_index": 0, "peak": 0.0, "silent": true}
	var level := p * threshold
	var first := -1
	var last := -1
	var peak_index := 0
	for i in samples.size():
		var a := absf(samples[i])
		if a >= level:
			if first < 0:
				first = i
			last = i
		if a == p and peak_index == 0:
			peak_index = i
	return {
		"attack": (peak_index - first) / rate,
		"duration": (last - first + 1) / rate,
		"peak_index": peak_index,
		"peak": p,
		"silent": false,
	}


## How many separate bursts of sound a buffer contains, for cascade assertions.
static func count_bursts(samples: PackedFloat32Array, rate: float, gap_seconds := 0.01) -> int:
	var p := peak(samples)
	if p <= 0.0:
		return 0
	var level := p * 0.06
	var gap := maxi(1, roundi(gap_seconds * rate))
	var bursts := 0
	var quiet := gap
	for s in samples:
		if absf(s) >= level:
			if quiet >= gap:
				bursts += 1
			quiet = 0
		else:
			quiet += 1
	return bursts


## Everything the web game's debug page measures of a sound, under the same names.
static func measure(samples: PackedFloat32Array, rate: float) -> Dictionary:
	var env := envelope(samples, rate)
	var mags := magnitude_spectrum(samples)
	# Skip the first 8 ms so a broadband transient does not mask the body's pitch.
	var body_start := mini(samples.size() - 1, roundi(0.008 * rate))
	return {
		"samples": samples.size(),
		"peak": env["peak"],
		"rms": rms(samples),
		"centroid": centroid_of(mags, rate),
		"dominant": dominant_of(mags, rate),
		"bodyHz": dominant_frequency(samples.slice(body_start), rate),
		"attackMs": env["attack"] * 1000.0,
		"durationMs": env["duration"] * 1000.0,
		"bursts": count_bursts(samples, rate),
	}
