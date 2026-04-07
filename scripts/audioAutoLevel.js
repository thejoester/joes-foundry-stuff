/* ============================================================================
	Joe's Foundry Stuff - Audio Auto Mix (World-Controlled)
	- GM sets world sliders
	- All clients force per-sound playback volume on start
	- Does NOT touch player volume settings
============================================================================ */

import { DL } from "./settings.js";

const JFS_ID = "joes-foundry-stuff";
const FN = "audioAutoLevel.js |";

let _wrapped = false;

function jfs_getSetting(key, fallback) {
    //DL(`${FN} jfs_getSetting() called for key "${key}" with fallback`, fallback);
	try {
		return game.settings.get(JFS_ID, key);
	} catch (err) {
		DL(`${FN} jfs_getSetting() failed for key "${key}", returning fallback`, fallback, err);
		return fallback;
	}
}

function jfs_isEnabled() {
    //DL(`${FN} jfs_isEnabled() called`);
	return !!jfs_getSetting("audioAutoMixEnabledWorld", false);
}

function jfs_targetVolumeForChannel(channel) {
	//DL(`${FN} jfs_targetVolumeForChannel() called`, channel);

	if (!jfs_isEnabled()) {
		//DL(`${FN} auto mix disabled`);
		return null;
	}

	let v = null;

	// Settings now stored as percent (0..100) in 5% steps.
	// Backward compatible: if someone still has 0..1 stored, accept it.
	if (channel === CONST.AUDIO_CHANNELS.MUSIC)
		v = jfs_getSetting("audioAutoMixWorldMusic", 50);

	else if (channel === CONST.AUDIO_CHANNELS.ENVIRONMENT)
		v = jfs_getSetting("audioAutoMixWorldEnvironment", 50);

	else if (channel === CONST.AUDIO_CHANNELS.INTERFACE)
		v = jfs_getSetting("audioAutoMixWorldInterface", 50);

	//DL(`${FN} raw target setting`, v);

	if (typeof v !== "number" || Number.isNaN(v)) return null;

	// Convert percent -> 0..1 (if needed)
	if (v > 1) v = v / 100;

	v = Math.max(0, Math.min(1, v));

	//DL(`${FN} resolved target volume (0..1)`, v);

	return v;
}

function jfs_detectChannelFromSound(sound) {
	//DL(`${FN} jfs_detectChannelFromSound() called for sound`, sound);

	try {
		const ctx = sound?.context;
		if (!ctx) {
			//DL(`${FN} no audio context found`);
			return null;
		}

		if (game.audio?.music && ctx === game.audio.music) {
			//DL(`${FN} detected MUSIC channel`);
			return CONST.AUDIO_CHANNELS.MUSIC;
		}

		if (game.audio?.environment && ctx === game.audio.environment) {
			//DL(`${FN} detected ENVIRONMENT channel`);
			return CONST.AUDIO_CHANNELS.ENVIRONMENT;
		}

		if (game.audio?.interface && ctx === game.audio.interface) {
			//DL(`${FN} detected INTERFACE channel`);
			return CONST.AUDIO_CHANNELS.INTERFACE;
		}

		//DL(`${FN} channel not detected`);
	} catch (err) {
		DL(`${FN} error detecting channel`, err);
	}

	return null;
}

function jfs_forceSoundVolume(sound, channel) {
	//DL(`${FN} jfs_forceSoundVolume() called for sound and channel`, sound, channel);

	const target = jfs_targetVolumeForChannel(channel);
	if (target === null) {
		DL(`${FN} jfs_forceSoundVolume(): no target volume resolved`, { channel });
		return;
	}

	const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
	const tVol = clamp01(target);

	const applyNow = (label) => {
		try {
			// Mark the instance so later hooks know what to enforce
			sound._jfsForcedVolume = tVol;

			// Prefer the public volume setter (lets Foundry do its own math)
			try {
				sound.volume = tVol;
				//DL(`${FN} ${label}: sound.volume after set`, sound.volume);
			} catch (err) {
				DL(`${FN} ${label}: sound.volume set failed`, err);
			}

			// Backup: enforce ONLY the sound's gainNode (not destination)
			if (sound.gainNode?.gain) {
				const now = sound.context?.currentTime ?? 0;

				if (typeof sound.gainNode.gain.setValueAtTime === "function") {
					sound.gainNode.gain.setValueAtTime(tVol, now);
				} else {
					sound.gainNode.gain.value = tVol;
				}

				//DL(`${FN} ${label}: gainNode.gain after set`, sound.gainNode.gain.value);
			} else {
				//DL(`${FN} ${label}: no sound.gainNode.gain present`, sound);
			}

		} catch (err) {
			DL(`${FN} ${label}: error applying forced volume`, err);
		}
	};

	// Apply immediately and once more after start (Foundry may overwrite once during init)
	applyNow("now");
	setTimeout(() => applyNow("t+25ms"), 25);
	setTimeout(() => applyNow("t+100ms"), 100);
}

function jfs_wrapSoundVolumeRefresh() {

	//DL(`${FN} jfs_wrapSoundVolumeRefresh() starting`);

	const proto = foundry.audio.Sound?.prototype;

	if (!proto) {
		DL(`${FN} jfs_wrapSoundVolumeRefresh(): foundry.audio.Sound.prototype not found`);
		return;
	}

	const candidates = [
		"_refreshVolume",
		"_applyVolume",
		"_updateVolume",
		"_refresh",
		"_applyPlayback"
	];

	let wrappedName = null;

	for (const name of candidates) {
		if (typeof proto[name] === "function") {
			wrappedName = name;
			break;
		}
	}

	if (!wrappedName) {
		DL(`${FN} jfs_wrapSoundVolumeRefresh(): no refresh method found on Sound.prototype`, Object.getOwnPropertyNames(proto));
		return;
	}

	//DL(`${FN} jfs_wrapSoundVolumeRefresh(): wrapping Sound.prototype.${wrappedName}`);

	const orig = proto[wrappedName];

	proto[wrappedName] = function (...args) {

		const result = orig.call(this, ...args);

		try {
			const forced = this._jfsForcedVolume;

			if (typeof forced === "number") {

				if (this.gainNode?.gain) {
					const t = this.context?.currentTime ?? 0;

					if (typeof this.gainNode.gain.setValueAtTime === "function") {
						this.gainNode.gain.setValueAtTime(forced, t);
					} else {
						this.gainNode.gain.value = forced;
					}

					//DL(`${FN} Sound.prototype.${wrappedName}(): gainNode after`, this.gainNode.gain.value);
				} else {
					DL(`${FN} Sound.prototype.${wrappedName}(): no gainNode.gain to set`, this);
				}

				if (this._playback && typeof this._playback === "object") {
					this._playback.volume = forced;
					//DL(`${FN} Sound.prototype.${wrappedName}(): playback.volume after`, this._playback.volume);
				}
			}
		} catch (err) {
			DL(`${FN} Sound.prototype.${wrappedName}(): error while enforcing`, err);
		}

		return result;
	};

	//DL(`${FN} jfs_wrapSoundVolumeRefresh(): wrapped Sound.prototype.${wrappedName}`);
}

function jfs_wrap() {
	//DL(`${FN} jfs_wrap() called`);

	if (_wrapped) return;
	_wrapped = true;

	//DL(`${JFS_ID} | ${FN} wrapping audio methods`);

	/* =====================================================================
		1) AudioHelper.play (covers many interface sounds)
	===================================================================== */
	const origAudioHelperPlay = foundry.audio.AudioHelper.play;

	foundry.audio.AudioHelper.play = function (data = {}, socketOptions) {
		try {
			const channel = data?.channel ?? null;

			// IMPORTANT: channel can be 0 (MUSIC). Do NOT use truthy checks.
			const target = (channel !== null) ? jfs_targetVolumeForChannel(channel) : null;

			if (target !== null) data = { ...data, volume: target };
		} catch (err) {
			//DL(`${FN} AudioHelper.play error:`, err);
		}

		const s = origAudioHelperPlay.call(this, data, socketOptions);

		try {
			const channel = data?.channel ?? null;
			if (s && channel !== null) jfs_forceSoundVolume(s, channel);
		} catch (err) {
			//DL(`${FN} AudioHelper.play post-play error:`, err);
		}

		return s;
	};

	/* =====================================================================
		2) Sound.play (fallback for sounds that bypass AudioHelper)
	===================================================================== */
	const origSoundPlay = foundry.audio.Sound.prototype.play;

	foundry.audio.Sound.prototype.play = function (options = {}) {
		try {
			const channel = jfs_detectChannelFromSound(this);

			// IMPORTANT: channel can be 0 (MUSIC). Do NOT use truthy checks.
			if (channel !== null) {
				const target = jfs_targetVolumeForChannel(channel);
				if (target !== null) options = { ...options, volume: target };
			}
		} catch (err) {
			//DL(`${FN} Sound.play pre-play error:`, err);
		}

		const result = origSoundPlay.call(this, options);

		try {
			const channel = jfs_detectChannelFromSound(this);
			if (channel !== null) jfs_forceSoundVolume(this, channel);
		} catch (err) {
			//DL(`${FN} Sound.play post-play error:`, err);
		}

		return result;
	};

	/* =====================================================================
		3) PlaylistSound.play (best effort, only if present globally)
	===================================================================== */
	if (globalThis.PlaylistSound?.prototype?.play) {
		//DL(`${JFS_ID} | ${FN} wrapping PlaylistSound.prototype.play`);

		const origPlaylistSoundPlay = globalThis.PlaylistSound.prototype.play;

		globalThis.PlaylistSound.prototype.play = async function (...args) {
			const result = await origPlaylistSoundPlay.call(this, ...args);

			try {
				const sound = this.sound;
				if (!sound) return result;

				const channel = jfs_detectChannelFromSound(sound);
				jfs_forceSoundVolume(sound, (channel !== null) ? channel : CONST.AUDIO_CHANNELS.MUSIC);
			} catch (err) {
				//DL(`${FN} PlaylistSound.prototype.play error:`, err);
			}

			return result;
		};
	} else {
		//DL(2, `${JFS_ID} | ${FN} PlaylistSound.prototype.play not found (unexpected)`);
	}

	jfs_wrapSoundVolumeRefresh();
}

function jfs_registerDocumentAutoLevelHooks() {
	//DL(`${FN} registering document auto-level hooks`);

	// PlaylistSound (Music)
	Hooks.on("updatePlaylistSound", async (doc, change, options) => {
		try {
			const channel = CONST.AUDIO_CHANNELS.MUSIC;

			// Skip our own updates
			if (options?.jfsAutoLevel) return;

			// Robust "started playing" detection:
			// - doc.playing is the authoritative post-update state
			// - change payload varies by Foundry version / operation
			const started =
				doc?.playing === true
				&& (
					change?.playing === true
					|| ("pausedTime" in (change ?? {}))
					|| ("position" in (change ?? {}))
					|| ("fade" in (change ?? {}))
				);

			if (!started) return;

			const target = jfs_targetVolumeForChannel(channel);
			if (target === null) return;

			const current = Number(doc.volume ?? 1);
			const desired = Math.max(0, Math.min(1, target));

			if (Math.abs(current - desired) < 0.001) return;

			await doc.update({ volume: desired }, { jfsAutoLevel: true, diff: false, render: true });
		} catch (err) {
			DL(`${FN} updatePlaylistSound(): error`, err);
		}
	});

	// AmbientSound (Environment)
	Hooks.on("updateAmbientSound", async (doc, change, options) => {
		try {
			if (options?.jfsAutoLevel) return;

			const channel = CONST.AUDIO_CHANNELS.ENVIRONMENT;
			const target = jfs_targetVolumeForChannel(channel);
			if (target === null) return;

			// Keep your relevant filter, but log what triggered it
			const relevant = ("path" in (change ?? {})) || ("volume" in (change ?? {})) || ("hidden" in (change ?? {}));
			//DL(`${FN} updateAmbientSound(): received`, { docId: doc?.id, changedKeys: Object.keys(change ?? {}), relevant });

			if (!relevant) return;

			const current = Number(doc.volume ?? 1);
			const desired = Math.max(0, Math.min(1, target));

			//DL(`${FN} updateAmbientSound(): enforcing doc.volume`, { docId: doc.id, current, desired });

			if (Math.abs(current - desired) < 0.001) return;

			await doc.update({ volume: desired }, { jfsAutoLevel: true, diff: false, render: true });
		} catch (err) {
			DL(`${FN} updateAmbientSound(): error`, err);
		}
	});
}
/* ============================================================================
	Hooks
============================================================================ */

// Hard proof the file is executing at all
Hooks.once("init", () => {
	DL(`${FN} init (audioAutoLevel.js loaded)`);
});

// Wrap at READY so audio classes are present
Hooks.once("ready", () => {
	DL(`${FN} ready`);

	// This is what was actually working for you before:
	// it clamps playback gain when sounds start playing.
	jfs_wrap();

	// GM-only: optional document-level syncing (sliders/UI)
	if (!game.user?.isGM) {
		DL(`${FN} not GM, skipping auto-level document hooks`);
		return;
	}

	jfs_registerDocumentAutoLevelHooks();
});