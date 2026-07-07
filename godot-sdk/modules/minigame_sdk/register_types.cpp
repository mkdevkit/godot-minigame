/**************************************************************************/
/*  register_types.cpp                                                    */
/**************************************************************************/

#include "register_types.h"

#include "minigame_sdk.h"

#include "core/config/engine.h"
#include "core/object/class_db.h"

static MiniGameSDK *minigame_sdk_singleton = nullptr;

void initialize_minigame_sdk_module(ModuleInitializationLevel p_level) {
	if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) {
		return;
	}
	ClassDB::register_class<MiniGameSDK>();
	minigame_sdk_singleton = memnew(MiniGameSDK);
	Engine::get_singleton()->add_singleton(Engine::Singleton("MiniGameSDK", MiniGameSDK::get_singleton()));
}

void uninitialize_minigame_sdk_module(ModuleInitializationLevel p_level) {
	if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) {
		return;
	}
	if (minigame_sdk_singleton) {
		memdelete(minigame_sdk_singleton);
		minigame_sdk_singleton = nullptr;
	}
}
