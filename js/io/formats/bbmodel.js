(function() {

let FORMATV = '4.0';

function processHeader(model) {
	if (!model.meta) {
		Blockbench.showMessageBox({
			translateKey: 'invalid_model',
			icon: 'error',
		})
		return;
	}
	if (!model.meta.format_version) {
		model.meta.format_version = model.meta.format;
	}
	if (compareVersions(model.meta.format_version, FORMATV)) {
		Blockbench.showMessageBox({
			translateKey: 'outdated_client',
			icon: 'error',
		})
		return;
	}
}
function processCompatibility(model) {

	if (!model.meta.model_format) {
		if (model.meta.bone_rig) {
			model.meta.model_format = 'bedrock_old';
		} else {
			model.meta.model_format = 'java_block';
		}
	}

	if (model.cubes && !model.elements) {
		model.elements = model.cubes;
	}

	if (model.outliner) {
		if (compareVersions('3.2', model.meta.format_version)) {
			//Fix Z-axis inversion pre 3.2
			function iterate(list) {
				for (var child of list) {
					if (typeof child == 'object' ) {
						iterate(child.children);
						if (child.rotation) child.rotation[2] *= -1;
					}
				}
			}
			iterate(model.outliner)
		}
	}
}

var codec = new Codec('project', {
	name: 'Blockbench Project',
	extension: 'bbmodel',
	remember: true,
	load_filter: {
		type: 'json',
		extensions: ['bbmodel']
	},
	load(model, file, add) {

		setupProject(Formats[model.meta.model_format] || Formats.free);
		var name = pathToName(file.path, true);
		if (file.path && isApp && !file.no_file ) {
			Project.save_path = file.path;
			Project.name = pathToName(name, false);
			addRecentProject({
				name,
				path: file.path,
				icon: 'icon-blockbench_file'
			})
		}
		this.parse(model, file.path)
	},
	export() {
		Blockbench.export({
			resource_id: 'model',
			type: this.name,
			extensions: [this.extension],
			name: this.fileName(),
			startpath: this.startPath(),
			content: isApp ? null : this.compile(),
			custom_writer: isApp ? (content, path) => {
				// Path needs to be changed before compiling for relative resource paths
				Project.save_path = path;
				content = this.compile();
				this.write(content, path);
			} : null,
		}, path => this.afterDownload(path))
	},
	compile(options) {
		if (!options) options = 0;
		var model = {
			meta: {
				format_version: FORMATV,
				creation_time: Math.round(new Date().getTime()/1000),
				backup: options.backup ? true : undefined,
				model_format: Format.id,
				box_uv: Project.box_uv
			}
		}
		
		for (var key in ModelProject.properties) {
			if (ModelProject.properties[key].export == false) continue;
			ModelProject.properties[key].copy(Project, model)
		}

		if (Project.overrides) {
			model.overrides = Project.overrides;
		}
		model.resolution = {
			width: Project.texture_width || 16,
			height: Project.texture_height || 16,
		}
		if (options.flag) {
			model.flag = options.flag;
		}
		model.elements = []
		elements.forEach(el => {
			var obj = el.getSaveCopy(model.meta)
			model.elements.push(obj)
		})
		model.outliner = compileGroups(true)

		model.textures = [];
		Texture.all.forEach(tex => {
			var t = tex.getUndoCopy();
			delete t.selected;
			if (isApp && Project.save_path && tex.path) {
				let relative = PathModule.relative(Project.save_path, tex.path);
				t.relative_path = relative.replace(/\\/g, '/');
			}
			if (options.bitmaps != false) {
				t.source = 'data:image/png;base64,'+tex.getBase64()
				t.mode = 'bitmap'
			}
			model.textures.push(t);
		})

		if (Animator.animations.length) {
			model.animations = [];
			Animator.animations.forEach(a => {
				model.animations.push(a.getUndoCopy({bone_names: true}, true))
			})
		}
		if (Interface.Panels.variable_placeholders.inside_vue._data.text) {
			model.animation_variable_placeholders = Interface.Panels.variable_placeholders.inside_vue._data.text;
		}

		if (Format.display_mode && Object.keys(Project.display_settings).length >= 1) {
			var new_display = {}
			var entries = 0;
			for (var i in DisplayMode.slots) {
				var key = DisplayMode.slots[i]
				if (DisplayMode.slots.hasOwnProperty(i) && Project.display_settings[key] && Project.display_settings[key].export) {
					new_display[key] = Project.display_settings[key].export()
					entries++;
				}
			}
			if (entries) {
				model.display = new_display
			}
		}

		if (!options.backup) {
			// Backgrounds
			const backgrounds = {};

			for (var key in canvas_scenes) {
				let scene = canvas_scenes[key];
				if (scene.image && scene.save_in_project !== false) {
					scene.save_in_project = true;
					backgrounds[key] = scene.getSaveCopy();
				}
			}
			if (Object.keys(backgrounds).length) {
				model.backgrounds = backgrounds;
			}
		}

		if (options.history) {
			model.history = [];
			Undo.history.forEach(h => {
				var e = {
					before: omitKeys(h.before, ['aspects']),
					post: omitKeys(h.post, ['aspects']),
					action: h.action
				}
				model.history.push(e);
			})
			model.history_index = Undo.index;
		}

		Blockbench.dispatchEvent('save_project', {model});
		this.dispatchEvent('compile', {model, options})

		if (options.raw) {
			return model;
		} else if (options.compressed) {
			var json_string = JSON.stringify(model);
			var compressed = '<lz>'+LZUTF8.compress(json_string, {outputEncoding: 'StorageBinaryString'});
			return compressed;
		} else {
			if (Settings.get('minify_bbmodel')) {
				return JSON.stringify(model);
			} else {
				return compileJSON(model);
			}
		}
	},
	parse(model, path) {

		processHeader(model);
		processCompatibility(model);

		if (model.meta.model_format) {
			if (!Formats[model.meta.model_format]) {
				Blockbench.showMessageBox({
					translateKey: 'invalid_format',
					message: tl('message.invalid_format.message', [model.meta.model_format])
				})
			}
			var format = Formats[model.meta.model_format]||Formats.free;
			format.select()
		}

		Blockbench.dispatchEvent('load_project', {model, path});
		this.dispatchEvent('parse', {model})

		if (model.meta.box_uv !== undefined && Format.optional_box_uv) {
			Project.box_uv = model.meta.box_uv
		}

		for (var key in ModelProject.properties) {
			ModelProject.properties[key].merge(Project, model)
		}

		if (model.overrides) {
			Project.overrides = model.overrides;
		}
		if (model.resolution !== undefined) {
			Project.texture_width = model.resolution.width;
			Project.texture_height = model.resolution.height;
		}

		if (model.textures) {
			model.textures.forEach(tex => {
				var tex_copy = new Texture(tex, tex.uuid).add(false);
				if (isApp && tex.relative_path && Project.save_path) {
					let resolved_path = PathModule.resolve(Project.save_path, tex.relative_path);
					if (fs.existsSync(resolved_path)) {
						tex_copy.fromPath(resolved_path)
						return;
					}
				}
				if (isApp && tex.path && fs.existsSync(tex.path) && !model.meta.backup) {
					tex_copy.fromPath(tex.path)
					return;
				}
				if (tex.source && tex.source.substr(0, 5) == 'data:') {
					tex_copy.fromDataURL(tex.source)
				}
			})
		}
		if (model.elements) {
			let default_texture = Texture.getDefault();
			model.elements.forEach(function(element) {

				var copy = OutlinerElement.fromSave(element, true)
				for (var face in copy.faces) {
					if (!Format.single_texture && element.faces) {
						var texture = element.faces[face].texture !== null && Texture.all[element.faces[face].texture]
						if (texture) {
							copy.faces[face].texture = texture.uuid
						}
					} else if (default_texture && copy.faces && copy.faces[face].texture !== null) {
						copy.faces[face].texture = default_texture.uuid
					}
				}
				copy.init()
				
			})
		}
		if (model.outliner) {
			parseGroups(model.outliner)
		}
		if (model.animations) {
			model.animations.forEach(ani => {
				var base_ani = new Animation()
				base_ani.uuid = ani.uuid;
				base_ani.extend(ani).add();
				if (isApp && Format.animation_files) {
					base_ani.saved_name = base_ani.name;
				}
			})
		}
		if (model.animation_variable_placeholders) {
			Interface.Panels.variable_placeholders.inside_vue._data.text = model.animation_variable_placeholders;
		}
		if (model.display !== undefined) {
			DisplayMode.loadJSON(model.display)
		}
		if (model.backgrounds) {
			for (var key in model.backgrounds) {
				if (canvas_scenes.hasOwnProperty(key)) {

					let store = model.backgrounds[key]
					let real = canvas_scenes[key]

					real.save_in_project = true;

					if (store.image	!== undefined) {real.image = store.image}
					if (store.size	!== undefined) {real.size = store.size}
					if (store.x		!== undefined) {real.x = store.x}
					if (store.y		!== undefined) {real.y = store.y}
					if (store.lock	!== undefined) {real.lock = store.lock}
				}
			}
			Preview.all.forEach(p => {
				if (p.canvas.isConnected) {
					p.loadBackground();
				}
			})
		}
		if (model.history) {
			Undo.history = model.history.slice()
			Undo.index = model.history_index;
		}
		Canvas.updateAllBones()
		Canvas.updateAllPositions()
		this.dispatchEvent('parsed', {model})
	},
	merge(model, path) {

		processHeader(model);
		processCompatibility(model);

		Blockbench.dispatchEvent('merge_project', {model, path});
		this.dispatchEvent('merge', {model})
		Project.added_models++;

		let new_elements = [];
		let new_textures = [];
		let new_animations = [];
		Undo.initEdit({
			elements: new_elements,
			textures: new_textures,
			animations: Format.animation_mode && new_animations,
			outliner: true,
			selection: true,
			uv_mode: true,
			display_slots: Format.display_mode && displayReferenceObjects.slots
		})

		if (Format.optional_box_uv && Project.box_uv && !model.meta.box_uv) {
			Project.box_uv = false;
		}

		if (model.overrides instanceof Array && Project.overrides instanceof Array) {
			Project.overrides.push(...model.overrides);
		}

		let width = model.resolution.width || Project.texture_width;
		let height = model.resolution.height || Project.texture_height;

		function loadTexture(tex) {
			if (isApp && Texture.all.find(tex2 => tex.path == tex2.path)) {
				return Texture.all.find(tex2 => tex.path == tex2.path)
			}
			var tex_copy = new Texture(tex, tex.uuid).add(false);
			if (isApp && tex.path && fs.existsSync(tex.path) && !model.meta.backup) {
				tex_copy.fromPath(tex.path)
				return tex_copy;
			}
			if (isApp && tex.relative_path && Project.save_path) {
				let resolved_path = PathModule.resolve(Project.save_path, tex.relative_path);
				if (fs.existsSync(resolved_path)) {
					tex_copy.fromPath(resolved_path)
					return tex_copy;
				}
			}
			if (tex.source && tex.source.substr(0, 5) == 'data:') {
				tex_copy.fromDataURL(tex.source)
				return tex_copy;
			}
		}

		if (model.textures && (!Format.single_texture || Texture.all.length == 0)) {
			new_textures.replace(model.textures.map(loadTexture))
		}

		if (model.elements) {
			let default_texture = new_textures[0] || Texture.getDefault();
			let format = Formats[model.meta.model_format] || Format
			model.elements.forEach(function(element) {
				if (!OutlinerElement.isTypePermitted(element.type)) return;

				var copy = OutlinerElement.fromSave(element, true)
				if (copy instanceof Cube) {
					for (var face in copy.faces) {
						if (!format.single_texture && element.faces) {
							var texture = element.faces[face].texture !== null && new_textures[element.faces[face].texture]
							if (texture) {
								copy.faces[face].texture = texture.uuid
							}
						} else if (default_texture && copy.faces && copy.faces[face].texture !== null) {
							copy.faces[face].texture = default_texture.uuid
						}
						if (!Project.box_uv) {
							copy.faces[face].uv[0] *= Project.texture_width / width;
							copy.faces[face].uv[2] *= Project.texture_width / width;
							copy.faces[face].uv[1] *= Project.texture_height / height;
							copy.faces[face].uv[3] *= Project.texture_height / height;
						}
					}
				} else if (copy instanceof Mesh) {
					for (let fkey in copy.faces) {
						if (!format.single_texture && element.faces) {
							var texture = element.faces[fkey].texture !== null && new_textures[element.faces[fkey].texture]
							if (texture) {
								copy.faces[fkey].texture = texture.uuid
							}
						} else if (default_texture && copy.faces && copy.faces[fkey].texture !== null) {
							copy.faces[fkey].texture = default_texture.uuid
						}
						for (let vkey in copy.faces[fkey].uv) {
							copy.faces[fkey].uv[vkey][0] *= Project.texture_width / width;
							copy.faces[fkey].uv[vkey][1] *= Project.texture_height / height;
						}
					}
				}
				copy.init()
				new_elements.push(copy);
			})
		}
		if (model.outliner) {
			parseGroups(model.outliner, true);
		}
		if (model.animations && Format.animation_mode) {
			model.animations.forEach(ani => {
				var base_ani = new Animation()
				base_ani.uuid = ani.uuid;
				base_ani.extend(ani).add();
				new_animations.push(base_ani);
			})
		}
		if (Format.bone_rig) {
			Group.all.forEachReverse(group => group.createUniqueName());
		}
		if (model.animation_variable_placeholders) {
			let vue = Interface.Panels.variable_placeholders.inside_vue;
			if (vue._data.text) {
				vue._data.text = vue._data.text + '\n\n' + model.animation_variable_placeholders;
			} else {
				vue._data.text = model.animation_variable_placeholders;
			}
		}
		if (model.display !== undefined) {
			DisplayMode.loadJSON(model.display)
		}
		Undo.finishEdit('Merge project')
		Canvas.updateAllBones()
		Canvas.updateAllPositions()
		this.dispatchEvent('parsed', {model})
	}
})
Formats.free.codec = codec;

BARS.defineActions(function() {
	codec.export_action = new Action('save_project', {
		icon: 'save',
		category: 'file',
		keybind: new Keybind({key: 's', ctrl: true, alt: true}),
		click: function () {
			saveTextures(true)
			if (isApp && Project.save_path) {
				codec.write(codec.compile(), Project.save_path);
			} else {
				codec.export()
			}
		}
	})

	new Action('save_project_as', {
		icon: 'save',
		category: 'file',
		keybind: new Keybind({key: 's', ctrl: true, alt: true, shift: true}),
		click: function () {
			saveTextures(true)
			codec.export()
		}
	})

	new Action('import_project', {
		icon: 'icon-blockbench_file',
		category: 'file',
		condition: () => Format,
		click: function () {
			Blockbench.import({
				resource_id: 'model',
				extensions: [codec.extension],
				type: codec.name,
				multiple: true,
			}, function(files) {
				files.forEach(file => {
					var model = autoParseJSON(file.content);
					codec.merge(model);
				})
			})
		}
	})
})

})()
