import { workspace, Range, Location } from 'vscode'
import { SupportedLanguageGlobs } from '../meta'
import { KeyDetector, Global, LocaleLoader } from '../core'
import * as fg from 'fast-glob'
import { resolve } from 'path'
import { promises as fs } from 'fs'

export interface Occurrence {
  keypath: string
  filepath: string
  start: number
  end: number
}

export class Analyst {
  private _cache: Occurrence[] | null = null

  constructor (
    readonly loader: LocaleLoader
  ) {}

  invalidateCache () {
    this._cache = null
  }

  invalidateCacheOf (filepath: string) {
    if (this._cache)
      this._cache = this._cache.filter(o => o.filepath !== filepath)
  }

  private async getDocumentPaths () {
    const root = workspace.rootPath
    if (!root)
      return []

    const ignore = [ // TODO: read from gitignore, configs
      'node_modules',
      '**/**/node_modules',
      'dist',
      '**/**/dist',
      '**/**/coverage',
      ...Global.localesPaths,
    ]
    const files = await fg(SupportedLanguageGlobs, {
      cwd: root,
      ignore,
    })

    return files.map(f => resolve(root, f))
  }

  private async getOccurrencesOfFile (filepath: string) {
    const text = await fs.readFile(filepath, 'utf-8')
    const keys = KeyDetector.getKeys(text)
    const occurrences: Occurrence[] = []

    for (const { start, end, key } of keys) {
      occurrences.push({
        keypath: key,
        start,
        end,
        filepath,
      })
    }

    return occurrences
  }

  async getAllOccurrences (targetKey?: string) {
    if (!this._cache) {
      const occurrences: Occurrence[] = []
      const filepaths = await this.getDocumentPaths()

      for (const filepath of filepaths)
        occurrences.push(...await this.getOccurrencesOfFile(filepath))

      this._cache = occurrences
    }

    if (targetKey)
      return this._cache.filter(({ keypath }) => keypath === targetKey)
    return this._cache
  }

  async getAllOccurrenceLocations (targetKey: string) {
    const occurrences = await this.getAllOccurrences(targetKey)
    return await Promise.all(occurrences.map(o => this.getLocationOf(o)))
  }

  async getLocationOf (occurrence: Occurrence) {
    const document = await workspace.openTextDocument(occurrence.filepath)
    const range = new Range(
      document.positionAt(occurrence.start),
      document.positionAt(occurrence.end),
    )
    return new Location(document.uri, range)
  }
}