/// <reference path="../types/typedefs.js" />

import { app } from '../../scripts/app.js'
import { api } from '../../scripts/api.js'

import * as mtb_ui from './mtb_ui.js'
import * as shared from './comfy_shared.js'

import {
  // defineCSSClass,
  ensureMTBStyles,
  makeElement,
  makeSelect,
  makeSlider,
  renderSidebar,
} from './mtb_ui.js'

const offset = 0

// These are "global" variables mostly meant to sync user settings.
let currentWidth = 200
let saltUrls =
  app.extensionManager.setting.get('mtb.io-sidebar.salt_urls') || false
let targetWidth =
  app.extensionManager.setting.get('mtb.io-sidebar.img-size') || 512
let currentMode = 'input'
let subfolder = ''
let currentSort = 'None'

const IMAGE_NODES = ['LoadImage', 'VHS_LoadImagePath']
const VIDEO_NODES = ['VHS_LoadVideo']
const PROCESSED_PROMPT_IDS = new Set()

const updateImage = (node, image) => {
  if (IMAGE_NODES.includes(node.type)) {
    const w = node.widgets?.find((w) => w.name === 'image')
    if (w) {
      w.value = image
      w.callback()
    }
  } else if (VIDEO_NODES.includes(node.type)) {
    const w = node.widgets?.find((w) => w.name === 'video')
    if (w) {
      node.updateParameters({ filename: image }, true)
    }
  } else {
    console.warn('No method to update', node.type)
  }
}

/**
 * Converts a result item to a request url.
 * @param {ResultItem} resultItem
 * @returns {string} - The request URL.
 */
const resultItemToQuery = (resultItem) => {
  const res = [
    `/mtb/view?filename=${resultItem.filename}`,
    `type=${resultItem.type}`,
    `subfolder=${resultItem.subfolder}`,
    'preview=',
  ]
  if (targetWidth > 0) {
    res.splice(1, 0, `width=${targetWidth}`)
  }

  return res.join('&')
}
/**
 * Retrieves the unique prompt ID from a history task item.
 * @param {HistoryTaskItem} historyTaskItem
 * @returns {string} - The prompt ID.
 */
const getPromptId = (historyTaskItem) => `${historyTaskItem.prompt[1]}`

/**
 * Process and return any new/unseen outputs from the most recent history item.
 * @param {HistoryTaskItem} mostRecentTask - The most recent history task item.
 * @returns {Object<string, string>} - A map of task outputs URLs.
 */
const getNewOutputUrls = (mostRecentTask) => {
  if (!mostRecentTask) return

  const promptId = getPromptId(mostRecentTask)
  if (PROCESSED_PROMPT_IDS.has(promptId)) return

  const urls = {}
  for (const nodeOutputs of Object.values(mostRecentTask.outputs)) {
    const { images, audio, animated } = nodeOutputs
    if (images) {
      const imageOutputs = Object.values(nodeOutputs.images)
      imageOutputs.forEach(
        (resultItem) =>
          (urls[resultItem.filename] = resultItemToQuery(resultItem)),
      )
    }
    // Can process `animated` and `audio` outputs here.
  }

  const foundNewOutputs = Object.keys(urls).length > 0
  if (!foundNewOutputs) return null

  PROCESSED_PROMPT_IDS.add(promptId)
  return urls
}

/** Fetch history and update the grid with any new ouput images. */
const updateOutputsGrid = async () => {
  try {
    const history = await api.getHistory(/** maxSize: */ 1)
    const mostRcentTask = history.History[0]
    const newUrls = getNewOutputUrls(mostRcentTask)
    if (newUrls) {
      const imgGrid = document.querySelector('.mtb_img_grid')
      getImgsFromUrls(newUrls, imgGrid, { prepend: true })
    }
  } catch (error) {
    console.error('Error fetching history:', error)
  }
}

const getImgsFromUrls = (urls, target, options = { prepend: false }) => {
  const imgs = []
  if (urls === undefined) {
    return imgs
  }
  const elem = currentMode === 'video' ? 'video' : 'img'

  for (const [key, url] of Object.entries(urls)) {
    const a = makeElement(elem)
    a.src = url
    a.width = currentWidth
    if (currentMode === 'input') {
      a.onclick = (_e) => {
        if (subfolder !== '') {
          app.extensionManager.toast.add({
            severity: 'warn',
            summary: 'Subfolder not supported',
            detail: "The LoadImage node doesn't support subfolders",
            life: 5000,
          })
          return
        }
        const selected = app.canvas.selected_nodes
        if (selected && Object.keys(selected).length === 0) {
          app.extensionManager.toast.add({
            severity: 'warn',
            summary: 'No node selected!',
            detail:
              'For now the only action when clicking images in the sidebar is to set the image on all selected LoadImage nodes.',
            life: 5000,
          })
          return
        }

        for (const [_id, node] of Object.entries(app.canvas.selected_nodes)) {
          updateImage(node, key)
        }
      }
    } else if (currentMode === 'output') {
      a.onclick = (_e) => {
        // window.MTB?.notify?.("Output import isn't supported yet...", 5000)
        if (subfolder !== '') {
          app.extensionManager.toast.add({
            severity: 'warn',
            summary: 'Subfolder not supported',
            detail: "The LoadImage node doesn't support subfolders",
            life: 5000,
          })
          return
        }

        app.extensionManager.toast.add({
          severity: 'warn',
          summary: 'Outputs not supported',
          detail:
            'For now only inputs can be clicked to load the image on the active LoadImage node.',
          life: 5000,
        })
      }
    } else {
      a.autoplay = true

      a.muted = true
      a.loop = true
      a.onclick = (_e) => {
        const selected = app.canvas.selected_nodes
        if (selected && Object.keys(selected).length === 0) {
          app.extensionManager.toast.add({
            severity: 'warn',
            summary: 'No node selected!',
            detail:
              "For now the only action when clicking videos in the sidebar is to set the video on all selected 'Load Video (Upload)' nodes.",
            life: 5000,
          })
          return
        }

        for (const [_id, node] of Object.entries(app.canvas.selected_nodes)) {
          updateImage(node, key)
        }
      }
    }
    imgs.push(a)
  }
  if (target !== undefined) {
    if (options.prepend) target.prepend(...imgs)
    else target.append(...imgs)
  }
  return imgs
}

const getModes = async () => {
  const inputs = await shared.runAction('getUserImageFolders')
  return inputs
}
const getUrls = async (subfolder) => {
  const count = (await api.getSetting('mtb.io-sidebar.count')) || 1000
  console.log('Sidebar count', count)
  if (currentMode === 'video') {
    const output = await shared.runAction(
      'getUserVideos',
      targetWidth,
      count,
      offset,
      currentSort,
    )
    return output || {}
  }
  const output = await shared.runAction(
    'getUserImages',
    currentMode,
    targetWidth,
    count,
    offset,
    currentSort,
    false,
    subfolder,
    saltUrls,
  )
  return output || {}
}

//NOTE: do not load if using the old ui
if (window?.__COMFYUI_FRONTEND_VERSION__) {
  // NOTE: removed this for now since I'm not actually exposing anything a client
  // cannot already access from "/view"...
  // let exposed = false

  const sidebar_extension = {
    name: 'mtb.io-sidebar',
    settings: [
      {
        id: 'mtb.io-sidebar.count',
        category: ['mtb', 'Input & Output Sidebar', 'count'],
        name: 'Number of images to fetch',
        type: 'number',
        defaultValue: 1000,
        tooltip:
          "This setting affects the input/output sidebar to determine how many images to fetch per pagination (pagination is not yet supported so for now it's the static total)",
      },
      {
        id: 'mtb.io-sidebar.salt_urls',
        category: ['mtb', 'Input & Output Sidebar', 'salt_urls'],
        name: 'Salt URLs',
        type: 'boolean',
        defaultValue: false,
        onChange: (n, o) => {
          saltUrls = n
        },
        tooltip:
          'Adds a random query parameter to every urls to always invalidate caching.',
      },
      {
        id: 'mtb.io-sidebar.img-size',
        category: ['mtb', 'Input & Output Sidebar', 'img-size'],

        name: 'Resize width of shown images',
        defaultValue: 512,
        type: (name, setter, value, attrs) => {
          targetWidth = value
          const container = mtb_ui.makeElement('div', {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          })

          console.log({ name, setter, value, attrs })

          const baseId = name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
          const checkboxId = `${baseId}-checkbox`
          const numberInputId = `${baseId}-number`

          const isCheckedInitially = value !== -1

          // TODO: better way to get defaultValue?
          const defaultValue = 512
          const initialNumberValue = isCheckedInitially ? value : defaultValue

          console.log('recreate')
          const checkbox = mtb_ui.makeElement(
            // harder to match styles (.p-toggleswitch-input)
            // since it uses a div synced to the input...
            'input',
            {},
            container,
          )
          checkbox.type = 'checkbox'
          checkbox.id = checkboxId
          checkbox.checked = isCheckedInitially

          const numberInput = mtb_ui.makeElement(
            'input.p-inputtext',
            {},
            container,
          )
          numberInput.type = 'number'
          numberInput.id = numberInputId
          numberInput.value = initialNumberValue
          numberInput.disabled = !isCheckedInitially
          numberInput.min = 128

          checkbox.addEventListener('change', () => {
            let valToSet = -1
            if (checkbox.checked) {
              numberInput.disabled = false

              valToSet = Number.parseInt(numberInput.value, 10)
              if (Number.isNaN(valToSet) || valToSet < numberInput.min) {
                valToSet = defaultValue
                numberInput.value = valToSet
              }
            } else {
              numberInput.disabled = true
            }
            setter(valToSet)
          })

          numberInput.addEventListener('input', () => {
            if (checkbox.checked) {
              const numValue = Number.parseInt(numberInput.value, 10)
              if (!Number.isNaN(numValue) && numberInput.value !== '') {
                setter(numValue)
              }
            }
          })

          return container
        },

        tooltip:
          "If browsing large folders it's recommended to use this to avoid overflow/crash of the webpage. Image will get resized to this target width on the server before being sent to the client.",
      },

      {
        id: 'mtb.io-sidebar.sort',
        category: ['mtb', 'Input & Output Sidebar', 'sort'],
        name: 'Default sort mode',
        type: 'combo',

        onChange: (v) => {
          // alert(`Sort is now ${v}`)
          currentSort = v
        },

        defaultValue: 'Modified',
        // tooltip: "It's recommended to keep it at 512px",
        options: [
          'None',
          'Modified',
          'Modified-Reverse',
          'Name',
          'Name-Reverse',
        ],
      },
      {
        id: 'mtb.io-sidebar.notice',
        category: ['mtb', 'Input & Output Sidebar', 'sort'],
        name: ' ',

        type: (name, setter, value, attrs) => {
          const container = mtb_ui.makeElement('div')
          const notice =
            '## Important\nIf you make **any** edits here you need to toggle off and back on the sidebar for it to take effect.'

          if (window.MTB?.mdParser) {
            MTB.mdParser.parse(notice).then((e) => {
              container.innerHTML = e
            })
          } else {
            shared.ensureMarkdownParser((p) => {
              p.parse(notice).then((e) => {
                container.innerHTML = e
              })
            })
          }
          return container
        },
      },
    ],

    init: () => {
      let handle
      const version = window?.__COMFYUI_FRONTEND_VERSION__
      console.log(`%c ${version}`, 'background: orange; color: white;')

      ensureMTBStyles()

      app.extensionManager.registerSidebarTab({
        id: 'mtb-inputs-outputs',
        icon: 'pi pi-images',
        title: 'Input & Outputs',
        tooltip: 'MTB: Browse inputs and outputs directories.',
        type: 'custom',

        // this is run everytime the tab's diplay is toggled on.
        render: async (el) => {
          if (handle) {
            handle.unregister()
            handle = undefined
          }

          if (el.parentNode) {
            el.parentNode.style.overflowY = 'clip'
          }

          const allModes = await getModes()
          const input_modes = allModes.input.map((m) => `input - ${m}`)
          const output_modes = allModes.output.map((m) => `output - ${m}`)
          const urls = await getUrls()
          let imgs = {}

          const cont = makeElement('div.mtb_sidebar')

          const imgGrid = makeElement('div.mtb_img_grid')
          const selector = makeSelect(
            ['input', 'output', 'video', ...output_modes, ...input_modes],
            currentMode,
          )

          selector.addEventListener('change', async (e) => {
            let newMode = e.target.value
            let changed = false
            let newSub = ''
            if (newMode !== 'input' && newMode !== 'output') {
              if (newMode.startsWith('input - ')) {
                newSub = newMode.replace('input - ', '')
                newMode = 'input'
              } else if (newMode.startsWith('output - ')) {
                newSub = newMode.replace('output - ', '')
                newMode = 'output'
              }
            }
            changed = newMode !== currentMode || newSub !== subfolder
            currentMode = newMode
            subfolder = newSub
            if (changed) {
              imgGrid.innerHTML = ''
              const urls = await getUrls(subfolder)
              if (urls) {
                imgs = getImgsFromUrls(urls, imgGrid)
              }
            }
          })

          const imgTools = makeElement('div.mtb_tools')
          const orderSelect = makeSelect(
            ['None', 'Modified', 'Modified-Reverse', 'Name', 'Name-Reverse'],
            currentSort,
          )

          orderSelect.addEventListener('change', async (e) => {
            const newSort = e.target.value
            const changed = newSort !== currentSort
            currentSort = newSort
            if (changed) {
              imgGrid.innerHTML = ''
              const urls = await getUrls(subfolder)
              if (urls) {
                imgs = getImgsFromUrls(urls, imgGrid)
              }
            }
          })

          const sizeSlider = makeSlider(64, 1024, currentWidth, 1)
          imgTools.appendChild(orderSelect)
          imgTools.appendChild(sizeSlider)

          imgs = getImgsFromUrls(urls, imgGrid)

          sizeSlider.addEventListener('input', (e) => {
            currentWidth = e.target.value
            for (const img of imgs) {
              img.style.width = `${e.target.value}px`
            }
          })
          handle = renderSidebar(el, cont, [selector, imgGrid, imgTools])
          app.api.addEventListener('status', async () => {
            if (currentMode !== 'output') return
            updateOutputsGrid()
          })
        },
        destroy: () => {
          if (handle) {
            handle.unregister()
            handle = undefined
            app.api.removeEventListener('status')
          }
        },
      })
    },
  }

  app.registerExtension(sidebar_extension)
}
