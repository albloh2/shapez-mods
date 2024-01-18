// @ts-nocheck
const METADATA = {
	website: "https://cable.ayra.ch",
	author: "AyrA",
	name: "Shape finder",
	version: "2",
	id: "findShape9001",
	description: "Searches the given shape within the specified radius",
	minimumGameVersion: ">=1.5.0",
	doesNotAffectSavegame: true
};

// Need to add this to the readme file:
// <a href="https://www.flaticon.com/free-icons/magnifying-glass" title="magnifying glass icons">Magnifying glass icons created by Freepik - Flaticon</a>

class Mod extends shapez.Mod {
	init() {
		const self = this;
		window.sf = this;

		//Add search button
		const addBtn = function () {
			const menu = document.querySelector("#ingame_HUD_GameMenu");
			//The game menu loads after the "InGameState" trigger. Possibly a bug
			if (!menu) {
				setTimeout(addBtn, 10);
				return;
			}
			const btn = menu.appendChild(document.createElement("button"));
			btn.addEventListener("click", function (e) {
				e.preventDefault();
				self.showFindDialog();
			});
			btn.style.backgroundImage = "url(data:image/png;base64," + self.icon + ")";
		};

		this.signals.stateEntered.add(state => {
			if (state.key === "InGameState") {
				addBtn();
			}
		});

		this.modInterface.registerIngameKeybinding({
			id: "findShape9001_mod_binding",
			keyCode: shapez.keyToKeyCode("F"),
			modifiers: {
				ctrl: true
			},
			translation: "Open the shape finder",
			handler: root => {
				self.showFindDialog();
				return shapez.STOP_PROPAGATION;
			}
		});

		window.findShape = function (shape, radius) {
			return self.findShape([shape], radius, false);
		};
		console.log("Shape finder loaded. Use window.findShape(shape,radius) to find a given shape");
	}

	showFindDialog() {
		const self = this;
		const lastSearch = this.lastSearch || {
			item: "",
			radius: 500,
			quick: false,
			rotate: true
		};

		const checkRadius = function (x) {
			return +x === +x && Math.floor(+x) === +x && +x > 0 && +x <= 5000;
		};

		const searchInput = new shapez.FormElementInput({
			id: "findItem",
			label: "Shape declaration",
			placeholder: "Shape declaration",
			defaultValue: lastSearch.item,
			validator: val => self.validateSignalCode(val)
		});

		const searchRadius = new shapez.FormElementInput({
			id: "findRadius",
			label: "Search radius (in squares, max 5000)",
			placeholder: "Search radius",
			defaultValue: lastSearch.radius.toString(),
			validator: val => checkRadius(+val)
		});

		const shortcut = new shapez.FormElementCheckbox({
			id: "findShortcut",
			label: "Quick search (do not try to find closest node to camera)",
			placeholder: "",
			defaultValue: lastSearch.quick
		});

		const rotate = new shapez.FormElementCheckbox({
			id: "allowRotate",
			label: "Allow rotated shapes",
			placeholder: "",
			defaultValue: lastSearch.rotate
		});

		const dialog = new shapez.DialogWithForm({
			app: self.app,
			title: "Shape finder",
			desc: "<h3>Enter the shape code of length 4 using any of the 4 letters 'CRSW', or a dash for positions you don't care about.</h3>",
			formElements: [searchInput, searchRadius, shortcut, rotate],
			buttons: ["cancel:bad:escape", "ok:good:enter"],
			closeButton: false,
		});

		const handleDialogResult = () => {
			const root = self.app.stateMgr.currentState.core.root;
			if (!root || !root.entityMgr) {
				// Game got stopped
				console.warn("Game stopped while dialog was open!");
				return;
			}
			const fields = {
				item: searchInput.getValue().toUpperCase(),
				radius: +searchRadius.getValue(),
				quick: shortcut.getValue(),
				rotate: rotate.getValue(),
				permutations: self.getPermutatedCodes(searchInput.getValue().toUpperCase())
			};
			self.lastSearch = fields;
			console.log("find request", fields);
			self.findShape(fields.rotate ? fields.permutations : [fields.item], fields.radius, fields.quick);
		};

		dialog.buttonSignals.ok.add(handleDialogResult);
		self.dialogs.internalShowDialog(dialog);
		return dialog;
	}

	validateSignalCode(code) {
		return typeof(code) === typeof("") && !!code.match(/^[CRSW\-]{4}$/i);
	}

	getPermutatedCodes(code) {
		const ret = [];
		if (this.validateSignalCode(code)) {
			var chars = code.split("");
			ret.push(code);

			chars.unshift(chars.pop());
			ret.push(chars.join(""));

			chars.unshift(chars.pop());
			ret.push(chars.join(""));

			chars.unshift(chars.pop());
			ret.push(chars.join(""));
		}
		return ret.filter((v, i, a) => a.indexOf(v) === i);
	}

	findShape(shapes, radius, quick) {
		const self = this;
		//Distance between two points
		const dist = function (x1, y1, x2, y2) {
			return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
		};
		if (!(shapes instanceof Array) || shapes.length === 0 || shapes.filter(v => !self.validateSignalCode(v)).length > 0) {
			throw new Error("Argument 'shapes': Expected array of shape strings of length 4 and made up of only the characters 'CRSW'. Argument was", shapes);
		}
		if (shapes.map(v => v.toUpperCase()).indexOf("WWWW") >= 0) {
			self.dialogs.showInfo("Shape finder", "A shape made exclusively out of windmill pieces \"W\" cannot exist.");
			return false;
		}

		if (typeof(radius) !== typeof(1) || radius < 1 || radius !== Math.floor(radius)) {
			throw new Error("Argument 'radius': Expected positive integer. Argument was", radius);
		}

		if (typeof(quick) !== typeof(true)) {
			throw new Error("Argument 'quick': Expected boolean. Argument was", quick);
		}

		const setCamera = function (pos) {
			console.log("Found closest shape at", pos);
			camera.desiredZoom = 1;
			camera.desiredCenter = pos;
		};

		const checkValue = function (value, patterns) {
			for (var i = 0; i < patterns.length; i++) {
				if (patterns[i].exec(value)) {
					return true;
				}
			}
			return false;
		};

		const search = shapes.map(s => new RegExp("^" + s.split("").map(v => v + "u").join("").replace(/\-/g, '.') + "$"));
		const targetCoords = {
			x: 0,
			y: 0
		};
		const r = radius;
		const map = self.app.stateMgr.currentState.core.root.map;
		const camera = self.app.stateMgr.currentState.core.root.camera;

		let bestDist = Number.POSITIVE_INFINITY;
		const chunkSizeTiles = 16;
		const tileSizePixels = 32;
		const tileCoords = {
			x: Math.round(camera.center.x / tileSizePixels),
			y: Math.round(camera.center.y / tileSizePixels),
		};

		setTimeout(self.cleanup.bind(self), 500);

		console.debug("Trying to find tiles around", tileCoords);
		for (let x = tileCoords.x - r; x < tileCoords.x + r; x += chunkSizeTiles) {
			for (let y = tileCoords.y - r; y < tileCoords.y + r; y += chunkSizeTiles) {
				const c = map.getOrCreateChunkAtTile(x, y);
				for (let i = 0; i < c.patches.length; i++) {
					const item = c.patches[i].item;
					if (item._type === "shape" && checkValue(item.definition.cachedHash, search)) {
						const pos = c.patches[i].pos;
						const distance = dist(
								c.tileX + pos.x, c.tileY + pos.y,
								tileCoords.x, tileCoords.y);
						console.debug(item.definition.cachedHash + " at X=" + x + ", Y=" + y + ", dist=" + Math.floor(distance));
						if (distance < bestDist) {
							console.debug("Closest distance so far:", Math.floor(distance));
							bestDist = distance;
							targetCoords.x = c.worldSpaceRectangle.x + pos.x * tileSizePixels;
							targetCoords.y = c.worldSpaceRectangle.y + pos.y * tileSizePixels;
							if (quick) {
								console.log("Quick search. Exiting after first result");
								setCamera(targetCoords);
								return true;
							}
						}
					}
				}
			}
		}
		if (bestDist < Number.POSITIVE_INFINITY) {
			setCamera(targetCoords);
			return true;
		}
		self.dialogs.showInfo("Shape finder", shapes.join(" or ") + " could not be found in a " + radius + " block radius");
		return false;
	}

	cleanup() {
		const self = this;
		const map = self.app.stateMgr.currentState.core.root.map;
		const pending = [];
		let removed = 0;
		map.chunksById.forEach(function (v, k) {
			if (v.containedEntities.length === 0) {
				pending.push(v.x + "|" + v.y);
			}
		});
		pending.forEach(function (v) {
			removed += map.chunksById.delete(v) ? 1 : 0;
		});
		console.log("Removed", removed, "empty chunks");
	}

	get icon() {
		return "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAAAA3NCSVQICAjb4U/" +
		"gAAAACXBIWXMAAAOnAAADpwE8lLkYAAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2" +
		"NhcGUub3Jnm+48GgAAAr5QTFRF////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
		"AAAAAAAAAAAAAAAAASC4HpAAAAOl0Uk5TAAECAwQFBgcICQoLDA0ODxAREhMUFh" +
		"cZGhscHR4fICEiJCUmJygpKissLS4wMTM0NTY3ODk6Ozw9P0BBQkNERUZHSElKS" +
		"0xNTlBRUlNUVVZXWFlaXF9gYWJjZGZnaGlqa2xtbm9wcXJzdHV2d3h5ent8fX5/" +
		"gIGCg4SGiImKi4yNjo+QkZKTlJWWl5iZmpudnp+go6Slpqeoqqusra6vsLGys7S" +
		"1tri5u7y9vr/AwcLDxMXGx8jJysvMzs/Q0dLT1dbX2Nna29zd3t/g4eLj5OXn6O" +
		"nq6+zt7u/w8fLz9PX29/j5+vv8/f4gQEFyAAAGX0lEQVR42u2b+1sUVRjHD6CAC" +
		"ggBYhAliVgQGV4qIkzAGyIZQUIZdAEKsQtmYIWJqWhElpSQF5AszQtIcjESzJK8" +
		"IZiIggGp3Jf5L2JnhodzZmd3z3t2Z6eeZ9+fhuN+3/ezO2fe877njAhRmHNwVFL" +
		"WztKa5t6u8yeK8zLiw/xtkcXsgTeODnA6dqsoxskCwW3mbDzL6bP+IyneyoafUd" +
		"DGGbGGdZMVC++5Y5CjsBvJExQJ75xzh6O0i6tszB7ePu0WB7AzC80cf9VVDmjHH" +
		"jFjeLvtHNzurDBbfLdjHIuNfGCm+AGXOEbbZ5YncnEPx2wNPqbHz9QYijDQenPE" +
		"0L+3LzA1/i49nodObkiKDPIYfd4neIdEv7ZN320aiDEt/jpZr10l8W7ST/qvrRq" +
		"W+2zvEybdf7nf/0iYnlTrliSXLW6YMA9mdev6Ox1qKF+myuTLxims8V0v6DhrWs" +
		"GwYpQz1ip2P0k9DabaUayZZToEn7IB5En9dITS1SzZOk9mLEv8OKmX3x+ilcbek" +
		"0j/YpgGjtclTg4504sfa5WIP4EDrJW4yAfNJM8GST7yg8Z36ZR8f+BM9m4n9Yeh" +
		"ADmk/g9nqIMFksp9KUzu8Q+h/tsPfg+TSIDL9iD1Z4R4mKnC20YSxIHuYB+hfZs" +
		"tkVWSRSJEW0BI/7Rjy2SBxFI24kuvtCWXlOfF4Sc/THYFERQTbrLphXPJukrsMr" +
		"Zo19aZEAC/IdxPC323spEAWCwMvi4UAybUU/RTmUhj1cJYmPBtOmDpqB/3VEwrm" +
		"05wR/JjD4qZ8SxsHhYStRGt6hVc1TORHzsg/rkSBhBBfBfa4qwcF+3nhx4Xl/h8" +
		"4JPocBf3FcMiWs2PicXRcXDnfxD3lUunCcY1Gk8+Awh/dN4HTkbE7TxBWYsTRTA" +
		"/JHbHmfBs6IWXZz10meBlHCCHH7rMX7dNYsjHv+HeZlFJ1utMAX/h+mOWBeF73F" +
		"sElWQnLlmkHUkTruezAHwJr45LcUngOFInU3+RjXtLpJLU4hL3caQqpjU5GfeWS" +
		"iVpxqtZDGkvE0A0DpBFJenFFK0Y0nYmgHk4wCYqSRe+w8GPNPHXXzABhOIABVSS" +
		"JjwR8rm3QmhymQBewAHovkMFLrlfO1LCX/7CBJCGe1tPJSnBJXPGijGO62faaMj" +
		"Fvb1EJdmCS5ZrRxKE62gWgG9wb+HwtvRVvk8S6usiFgBil4OupE0gmmJ+qE5ICr" +
		"4MANdwb3Q7p+G45Aq+Pu1maE5wZ7fpNP5EHRegHfIVWt3huWCA94hTBEoRsTeSi" +
		"VckbV5QgBrc12aWFVRYgjzFzbfaibD47hqWzmQpsSnsSjRLwDMAYkLfc6BUTerV" +
		"eRCRg/AgcJdMeAjp27ofiS02R6G6FE4Mr4LiP83BqwGdIoJ7S2yZ+yHzSLBqwpE" +
		"/fU9JbpCKG1TLOkb7JNAhDDGZxJRCZ42EcsPY3mUwbOfd9hzhJh0gfZNQ9rizbd" +
		"EkkDttkLN1+xZCW8Z0Eutzk3AC6ypWc6zbO+MP8xnCRd802BbbefIMkuEUdA/5H" +
		"QqB8pWSc9hHofEzSAeah6EOfiUdXAFOxOckR2jXwK93LJJs19eDFsKFXdLjjlNg" +
		"gkqJh+uAA8B0mSNEMEGA9My4L552Y6hI9rgTTLBM5+wpl6o/9qrTc4wLJsjScXE" +
		"8yKjIJl7/izZggn06LjTfGjk6i2g0dJgOJZgs887SQL6nfkFIhZEXCqAEvh1yL4" +
		"fsCJetDN0SDhl/pQFKEDok66a7JG4q+cEZ6ZVDVC9VQAni+vQ4Gqzbn/9+YlTwv" +
		"OiUnF0/NNG/1gElCGnjzGxQgun1ahM47lGbAL2jUZtgSY/aBD67h1UmQLPLIf7b" +
		"FSBA83+mfYutLHjqaSUI0JJzFOE1e7X1o0IEtsu/NvLjNueKHaCLMgSj633IR3p" +
		"X3JbNWNmmGIH2mUg53CJ5QaKvvnBNMPkpJQm0v4RHUGRi1udlB77a9O6a2EC58z" +
		"yFCSjMpc5KYCWwEvxHCGqtBOoTOFsJrARagpr/AUEpUpsgTm2CzmlqExxEahPMV" +
		"JvgRaQyQR5SnKDaIMBJpDJBF1KZ4IIFAJCTAYISpDJBBlKZ4BmkLsFtJ2QpglPq" +
		"5CEjBGUIqUqg9GIoJTgqiX83ClnW7LaSO1xByOL21Pht6M6agtSw2Qlbq7ovfpf" +
		"57Nj/JPoXYfGJVqHG56gAAAAASUVORK5CYII=";
	}
}
