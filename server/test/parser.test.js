import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMovieName, parseEpisode, episodeTitle, seasonFromFolder, stripSeasonMarker, cleanFolderName, commonPrefix } from '../src/parser.js';

test('film: anno e rumore', () => {
  assert.deepEqual(parseMovieName('Bastardi Senza Gloria 2009.mkv'), { title: 'Bastardi Senza Gloria', year: 2009 });
  assert.deepEqual(parseMovieName('Animali Fantastici i segreti di Silente - 2022.mp4'), { title: 'Animali Fantastici i segreti di Silente', year: 2022 });
  assert.deepEqual(parseMovieName('(1995) Toy Story 1 - Il Mondo Dei Giocattoli - bdrip 1080p h265.mp4'), { title: 'Toy Story 1 - Il Mondo Dei Giocattoli', year: 1995 });
  assert.deepEqual(parseMovieName('Ralph.Breaks.the.Internet.2018.4K.HDR.2160p.BDRip Ita Eng x265-NAHOM.mkv'), { title: 'Ralph Breaks the Internet', year: 2018 });
  assert.equal(parseMovieName('01 - Mewtwo contro Mew- byR02.mp4').title, 'Mewtwo contro Mew');
  assert.equal(parseMovieName('Stand by Me.mp4').title, 'Stand by Me');
});

test('episodi', () => {
  assert.equal(parseEpisode('How.I.Met.Your.Mother.1x01.Una.Lunga.Storia.ITA.avi').episode, 1);
  assert.equal(parseEpisode('How.I.Met.Your.Mother.9X01.Il.Medaglione.avi').season, 9);
  assert.equal(parseEpisode('5x07 A Tutto Reality.mp4').season, 5);
  assert.equal(parseEpisode('Dragon_Ball_Daima_E_Episodio_001_SUB_ITA.mp4').episode, 1);
  assert.equal(parseEpisode('Dragon Ball Kai Ep.01 ITA [Mux].mp4').episode, 1);
  assert.equal(parseEpisode('A Tutto Reality - Episodio 12 - Foo.mp4').episode, 12);
  const w = parseEpisode('Dragon Ball GT 001 ITA.mp4');
  assert.equal(w.strength, 'weak');
  assert.equal(w.episode, 1);
  assert.equal(parseEpisode('Bastardi Senza Gloria 2009.mkv'), null);
  assert.equal(parseEpisode('Film 1080p.mkv'), null);
});

test('titolo episodio', () => {
  assert.equal(episodeTitle('How.I.Met.Your.Mother.1x01.Una.Lunga.Storia.ITA.DVDMux.XviD-NovaRip.avi'), 'Una Lunga Storia');
  assert.equal(episodeTitle('A Tutto Reality La Vendetta Dell\'Isola - Episodio 2 - Il gioco della verita.mp4').startsWith('Il gioco'), true);
  assert.equal(episodeTitle('Dragon.Ball.001.Goku.conosce.Bulma.rmvb'), 'Goku conosce Bulma');
});

test('cartelle', () => {
  assert.equal(seasonFromFolder('How i meet your mother S03'), 3);
  assert.equal(seasonFromFolder('Dragon Ball Super'), null);
  assert.equal(stripSeasonMarker('How i meet your mother S03'), 'How i meet your mother');
  assert.equal(cleanFolderName('Corti - bdrip 1080p h265'), 'Corti');
});

test('prefisso comune', () => {
  const p = commonPrefix(['Missione Cosmo Ridicola - A.mp4', 'Missione Cosmo Ridicola - B.mp4', 'Missione Cosmo Ridicola   Un Milione.mp4']);
  assert.equal(p, 'missione cosmo ridicola');
  assert.equal(commonPrefix(['01 - Mewtwo.mp4', '02 - La forza.mp4']), '');
});
