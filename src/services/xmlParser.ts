/**
 * Rekordbox XML Parser
 * Parses Rekordbox XML export files into Track objects
 */

import { readFileSync } from 'fs';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Track, Playlist, RekordboxLibrary, CuePoint } from '../types.js';

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '_text',
  parseAttributeValue: false,
  trimValues: true,
};

export class RekordboxParser {
  private parser: XMLParser;
  private builder: XMLBuilder;

  constructor() {
    this.parser = new XMLParser(parserOptions);
    this.builder = new XMLBuilder({
      ...parserOptions,
      format: true,
      indentBy: '  ',
      suppressEmptyNode: true,
    });
  }

  parseXML(xmlContent: string): RekordboxLibrary {
    const parsed = this.parser.parse(xmlContent);

    const djPlaylists = parsed.DJ_PLAYLISTS;
    const collection = djPlaylists?.COLLECTION;
    const playlists = djPlaylists?.PLAYLISTS;

    const tracks = this.parseTracks(collection);
    const playlistsData = this.parsePlaylists(playlists);

    return {
      tracks,
      playlists: playlistsData,
    };
  }

  parseFromFile(filePath: string): RekordboxLibrary {
    const content = readFileSync(filePath, 'utf-8');
    return this.parseXML(content);
  }

  private parseTracks(collection: any): Track[] {
    if (!collection || !collection.TRACK) {
      return [];
    }

    const trackArray = Array.isArray(collection.TRACK)
      ? collection.TRACK
      : [collection.TRACK];

    return trackArray.map((track: any) => {
      const cuePoints = this.parseCuePoints(track.POSITION_MARK);

      return {
        TrackID: track.TrackID || '',
        Name: track.Name || '',
        Artist: track.Artist || '',
        Album: track.Album,
        Genre: track.Genre,
        Kind: track.Kind,
        Size: track.Size,
        TotalTime: track.TotalTime,
        Year: track.Year,
        AverageBpm: track.AverageBpm,
        DateAdded: track.DateAdded,
        BitRate: track.BitRate,
        SampleRate: track.SampleRate,
        Comments: track.Comments,
        PlayCount: track.PlayCount,
        Rating: track.Rating,
        Location: track.Location,
        Remixer: track.Remixer,
        Tonality: track.Tonality,
        Key: track.Tonality,
        Label: track.Label,
        Mix: track.Mix,
        Grouping: track.Grouping,
        CuePoints: cuePoints,
        tags: this.parseMyTags(track.MyTag),
      };
    });
  }

  private parseMyTags(myTagString: string | undefined): Array<{ category: string; name: string }> | undefined {
    if (!myTagString || typeof myTagString !== 'string') {
      return undefined;
    }

    const tags: Array<{ category: string; name: string }> = [];
    const tagStrings = myTagString.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

    for (const tagStr of tagStrings) {
      const colonIndex = tagStr.indexOf(':');
      if (colonIndex > 0) {
        const category = tagStr.substring(0, colonIndex).trim();
        const name = tagStr.substring(colonIndex + 1).trim();
        if (category && name) {
          tags.push({ category, name });
        }
      } else {
        tags.push({ category: 'Custom', name: tagStr });
      }
    }

    return tags.length > 0 ? tags : undefined;
  }

  private parseCuePoints(positionMarks: any): CuePoint[] {
    if (!positionMarks) {
      return [];
    }

    const marksArray = Array.isArray(positionMarks)
      ? positionMarks
      : [positionMarks];

    return marksArray.map((mark: any) => ({
      Name: mark.Name || '',
      Type: mark.Type || '',
      Start: mark.Start || '',
      Num: mark.Num || '',
      Red: mark.Red,
      Green: mark.Green,
      Blue: mark.Blue,
    }));
  }

  private parsePlaylists(playlists: any): Playlist[] {
    if (!playlists || !playlists.NODE) {
      return [];
    }

    const rootNode = playlists.NODE;
    return this.parsePlaylistNode(rootNode);
  }

  private parsePlaylistNode(node: any): Playlist[] {
    if (!node) {
      return [];
    }

    const nodes = Array.isArray(node) ? node : [node];
    const result: Playlist[] = [];

    for (const n of nodes) {
      const playlist: Playlist = {
        Name: n.Name || '',
        Type: n.Type || '',
        KeyType: n.KeyType || '',
        Entries: [],
        Children: [],
      };

      // Parse tracks in playlist
      if (n.TRACK) {
        const tracks = Array.isArray(n.TRACK) ? n.TRACK : [n.TRACK];
        playlist.Entries = tracks.map((t: any) => t.Key);
      }

      // Parse child playlists
      if (n.NODE) {
        playlist.Children = this.parsePlaylistNode(n.NODE);
      }

      result.push(playlist);
    }

    return result;
  }

  exportToXML(library: RekordboxLibrary): string {
    const xmlObject = {
      '?xml': {
        version: '1.0',
        encoding: 'UTF-8',
      },
      DJ_PLAYLISTS: {
        Version: '1.0.0',
        PRODUCT: {
          Name: 'B0nk MCP Server',
          Version: '1.0.0',
          Company: 'B0nk',
        },
        COLLECTION: {
          Entries: library.tracks.length.toString(),
          TRACK: library.tracks.map((track) => {
            const trackObj: any = {
              TrackID: track.TrackID,
              Name: track.Name,
              Artist: track.Artist,
            };

            // Add optional fields
            if (track.Album) trackObj.Album = track.Album;
            if (track.Genre) trackObj.Genre = track.Genre;
            if (track.Kind) trackObj.Kind = track.Kind;
            if (track.TotalTime) trackObj.TotalTime = track.TotalTime;
            if (track.Year) trackObj.Year = track.Year;
            if (track.AverageBpm) trackObj.AverageBpm = track.AverageBpm;
            if (track.DateAdded) trackObj.DateAdded = track.DateAdded;
            if (track.Comments) trackObj.Comments = track.Comments;
            if (track.Location) trackObj.Location = track.Location;
            if (track.Tonality) trackObj.Tonality = track.Tonality;
            if (track.Label) trackObj.Label = track.Label;
            if (track.Remixer) trackObj.Remixer = track.Remixer;

            // Add tags
            if (track.tags && Array.isArray(track.tags) && track.tags.length > 0) {
              const myTags = track.tags
                .filter((tag: any) => tag && tag.name)
                .map((tag: any) => tag.category ? `${tag.category}: ${tag.name}` : tag.name);
              if (myTags.length > 0) {
                trackObj.MyTag = myTags.join(', ');
              }
            }

            // Add cue points
            if (track.CuePoints && track.CuePoints.length > 0) {
              trackObj.POSITION_MARK = track.CuePoints.map((cue) => ({
                Name: cue.Name,
                Type: cue.Type,
                Start: cue.Start,
                Num: cue.Num,
              }));
            }

            return trackObj;
          }),
        },
      },
    };

    return this.builder.build(xmlObject);
  }
}
