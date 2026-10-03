class_name SaveStore
extends RefCounted
## Where the save lives: one JSON file, the same text the web game exports.
##
## The file on disk *is* the export format — pretty-printed, so a player who opens it can read
## it — which means "export" is a copy of the file and "import" is the same reader the game
## boots with. `encode` and `decode` are that format and nothing else; the instance adds a path.
##
## A store made with `memory()` keeps its text in a variable instead: the tests use it, and so
## can anything that wants progress without a disk under it.

const DEFAULT_PATH := "user://save.json"
## Where an unreadable save is set aside before a fresh one can overwrite it.
const REJECT_SUFFIX := ".unreadable"

var path := DEFAULT_PATH

var _in_memory := false
var _memory_text := ""
var _memory_has := false


func _init(save_path: String = DEFAULT_PATH) -> void:
	path = save_path


static func memory() -> SaveStore:
	var store := SaveStore.new("")
	store._in_memory = true
	return store


# ── The format ──────────────────────────────────────────────────────────────────────────

## A save as text: two-space indented JSON, byte for byte what the web game writes for the
## same data.
static func encode(data: Dictionary) -> String:
	return WebJson.stringify(data, "  ")


## Text back into a current-version save. `problem` says why when it cannot be — a sentence a
## player could act on.
static func decode(text: String) -> SaveData.Loaded:
	var json := WebJson.new()
	# A file saved by an editor may lead with a byte-order mark; it is not part of the JSON.
	if not json.parse(text.trim_prefix("﻿")):
		var failed := SaveData.Loaded.new()
		failed.existed = true
		failed.problem = "that file is not valid JSON"
		failed.data = SaveData.fresh()
		return failed
	return SaveData.migrate(json.data)


# ── The file ────────────────────────────────────────────────────────────────────────────

func exists() -> bool:
	return _memory_has if _in_memory else FileAccess.file_exists(path)


## The stored text, or "" when there is none.
func read_text() -> String:
	if _in_memory:
		return _memory_text
	return FileAccess.get_file_as_string(path) if FileAccess.file_exists(path) else ""


## Read the save, or start a fresh one. A save that is there but cannot be used is reported
## in `problem` and set aside beside the original, so the fresh save that replaces it does not
## destroy the only copy.
func load_save() -> SaveData.Loaded:
	if not exists():
		var fresh := SaveData.Loaded.new()
		fresh.data = SaveData.fresh()
		return fresh
	var text := read_text()
	var loaded := decode(text)
	if not loaded.ok() and not _in_memory:
		_write_file(path + REJECT_SUFFIX, text)
	return loaded


func write(data: Dictionary) -> Error:
	return write_text(encode(data))


func write_text(text: String) -> Error:
	if _in_memory:
		_memory_text = text
		_memory_has = true
		return OK
	# Written beside the save and moved over it, so a crash mid-write leaves the old file.
	var staging := path + ".tmp"
	var err := _write_file(staging, text)
	if err != OK:
		return err
	err = DirAccess.rename_absolute(staging, path)
	if err != OK:
		err = _write_file(path, text)
		DirAccess.remove_absolute(staging)
	return err


func clear() -> void:
	_memory_text = ""
	_memory_has = false
	if not _in_memory and FileAccess.file_exists(path):
		DirAccess.remove_absolute(path)


static func _write_file(file_path: String, text: String) -> Error:
	var file := FileAccess.open(file_path, FileAccess.WRITE)
	if file == null:
		return FileAccess.get_open_error()
	file.store_string(text)
	file.close()
	return OK
