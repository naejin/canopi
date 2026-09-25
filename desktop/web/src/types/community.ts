export interface TemplateMeta {
  id: string
  title: string
  author: string
  description: string
  location: { lat: number; lon: number }
  plant_count: number
  climate_zone: string
  tags: string[]
  screenshot_url: string | null
  download_url: string
}
