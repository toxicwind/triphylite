def _playback_mode(mode):
	return 'playback.' in (mode or '') or mode in _PLAYBACK_MODES

def route(mode, params):
	if _playback_mode(mode):
		from modules.kodi_utils import player_check
		return player_check(mode, params)
	elif mode == 'search.get_key_id':
		from modules.search import get_key_id
		return get_key_id(params)

def player_check(mode, params):
	from modules.settings import playback_key
	if mode == 'playback.%s' % playback_key():
		from modules.sources import Sources
		Sources().playback_prep(params)
	elif mode == 'playback.video':
		from modules.player import RedLightPlayer
		RedLightPlayer().run(params.get('url'), params.get('obj'))
