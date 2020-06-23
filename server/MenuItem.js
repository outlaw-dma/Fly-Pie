//////////////////////////////////////////////////////////////////////////////////////////
//   _____       _             _____ _                                                  //
//  |   __|_ _ _|_|___ ___ ___|  _  |_|___   This software may be modified and distri-  //
//  |__   | | | | |   | . |___|   __| | -_|  buted under the terms of the MIT license.  //
//  |_____|_____|_|_|_|_  |   |__|  |_|___|  See the LICENSE file for details.          //
//                    |___|                                                             //
//////////////////////////////////////////////////////////////////////////////////////////

'use strict';

const Cairo                     = imports.cairo;
const {Clutter, GObject, Pango} = imports.gi;

const Me    = imports.misc.extensionUtils.getCurrentExtension();
const utils = Me.imports.common.utils;

//////////////////////////////////////////////////////////////////////////////////////////
// Then MenuItem is a Clutter.Actor representing one node in the menu tree hierarchy.   //
// Based on a given MenuItemState, it is drawn differently. It is composed of several   //
// sub-actors, as shown in the diagram below:                                           //
//                                                                                      //
//   .----------.   .--------------------.   The caption displays the name of the       //
//   | MenuItem |---| _caption           |   currently hovered child item. It is re-    //
//   '----------'   '--------------------'   drawn whenever the hovered item changes.   //
//         |                                                                            //
//         |        .--------------------.   This contains up to six actors, one for    //
//         |--------| _iconContainer     |   each of the CENTER, CHILD or GRANDCHILD    //
//         |        '--------------------'   with their _HOVERED variants. Usually,     //
//         |                                 only one of them is visible at a time.     //
//         |                                                                            //
//         |        .--------------------.   This contains a MenuItem for each child    //
//         |--------| _childrenContainer |   in the menu tree hierarchy. Based on the   //
//         |        '--------------------'   drawChildrenAbove-settings, this could     //
//         |                                 also be above the _iconContainer.          //
//         |                                                                            //
//         |        .--------------------.   This represents the connection line to the //
//         '--------| _trace             |   active child. It is lazily allocated when  //
//                  '--------------------'   the state changes to PARENT.               //
//                                                                                      //
//////////////////////////////////////////////////////////////////////////////////////////

// This could be a static member of the class below, but this seems to be not supported
// yet.
var MenuItemState = {
  // This is the default state. It is also used for children of grandchildren - those are
  // not shown at all.
  INVISIBLE: 0,

  // This is the state of a MenuItem which is currently active but without the pointer
  // hoovering it. That means that one of its children is currently hovered.
  CENTER: 1,

  // Same as above, but without any hovered child. That means, the pointer is currently in
  // the center of the menu.
  CENTER_HOVERED: 2,

  // This is used for direct inactive children of the center element.
  CHILD: 3,

  // This is used for the currently active (hovered) direct child item of the center.
  CHILD_HOVERED: 4,

  // When the mouse gets pressed above a child, it gets this state. They are drawn in a
  // similar fashion as hovered children but do not automatically update their position.
  CHILD_DRAGGED: 5,

  // This is used for the children of the children of the center.
  GRANDCHILD: 6,

  // This is used for the children of the currently hovered child of the center.
  GRANDCHILD_HOVERED: 7,

  // This is used for the back-link children. In the menu hierarchy they are the parents
  // but they are drawn in a similar fashion as normal children.
  PARENT: 8,

  // Same as above, but currently hovered.
  PARENT_HOVERED: 9,
};

// clang-format off
var MenuItem = GObject.registerClass({
  Properties: {
    'angle': GObject.ParamSpec.double(
      'angle', 'angle', 'The angle of the MenuItem.',
      GObject.ParamFlags.READWRITE, 0, 2 * Math.PI, 0),
    'caption': GObject.ParamSpec.string(
      'caption', 'caption',
      'The caption to be used by this menu item. ',
      GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, ''),
    'icon': GObject.ParamSpec.string(
      'icon', 'icon',
      'The icon to be used by this menu item. ' +
      'Can be an "icon-name", an emoji like "🚀" or a path like "../icon.png".',
      GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, 'image-missing')
  },
  Signals: {}
},
class MenuItem extends Clutter.Actor {
  // clang-format on

  _init(params = {}) {
    super._init(params);

    // The state this MenuItem currently is in. This can be changed with setState(). To
    // reflect the new state, a redraw() will be required.
    this._state = MenuItemState.INVISIBLE;

    // This will be set to false upon the first call to redraw(). It is used to initialize
    // the MenuItem's appearance without animations.
    this._firstRedraw = true;

    // This is set to true when the icons were deleted due to the user modifying the
    // appearance settings in edit mode. If it is true, the icons will be re-created with
    // full opacity as they are obviously already visible. Else there would be heavy
    // preview-flickering when changing settings.
    this._forceRecreation = false;

    // This is recursively updated using setParentColor(). It is used for the background
    // coloring when the color mode is set to 'parent'.
    this._parentColor = new Clutter.Color({red: 255, green: 255, blue: 255});

    // Create Children Container. This eventually will contain one MenuItem for each child
    // item of this menu.
    this._childrenContainer = new Clutter.Actor();
    this.add_child(this._childrenContainer);

    // Create the Icon Container. This eventually will contain one actor for each visible
    // MenuItemState, except for the PARENT* states, as they are drawn like CHILDREN*. We
    // create one icon for each state as they most likely have different resolutions and
    // background colors. They are created lazily and usually only one of them is visible
    // at a time (based on the current MenuItemState). We use a Clutter.BinLayout to
    // position them exactly on top of each other to allow for smooth transitions.
    this._iconContainer = new Clutter.Actor();
    this._iconContainer.set_layout_manager(new Clutter.BinLayout());
    this.add_child(this._iconContainer);

    // This will contain an actor for each child displaying the name of the respective
    // child. Once a child is hovered the opacity of the corresponding caption will be set
    // to 255, all others will be set to zero.
    this._caption = Clutter.Text.new();
    this._caption.set_line_wrap(true);
    this._caption.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
    this._caption.set_ellipsize(Pango.EllipsizeMode.END);
    this._caption.set_line_alignment(Pango.Alignment.CENTER);
    this._caption.set_opacity(0);
    this.add_child(this._caption);
  }

  // This is called by the Menu to add child MenuItems to this MenuItem.
  addMenuItem(menuItem) {
    this._childrenContainer.add_child(menuItem);
  }

  // This is called during redraw() of the parent MenuItem. redraw() traverses the menu
  // tree top-to-bottom, so this will be called before the redraw() of this.
  setParentColor(color) {
    this._parentColor = color;
  }

  // This is called for each item in the current menu selection chain. That is for each
  // item which is either CENTER, CENTER_HOVERED, PARENT, or PARENT_HOVERED. It will call
  // itself recursively for the entire menu tree below the active item, updating each
  // child's state accordingly. An exception are the PARENT and PARENT_HOVERED states,
  // here only the inactive children are set to GRANDCHILD and GRANDCHILD_HOVERED
  // respectively. It's not called for the active child, as it's the responsibility to set
  // the state of the active child in this case.
  // The activeChildIndex can be omitted to indicate that it did not change.
  setState(state, activeChildIndex) {

    // Store the state and the active child's index as members. They will be used during
    // the next call to redraw().
    this._state = state;

    if (activeChildIndex != undefined) {
      this._activeChildIndex = activeChildIndex;
    }

    // Now call setState() recursively on all children.
    this._childrenContainer.get_children().forEach((child, index) => {
      switch (state) {

        // If the center item is hovered, no child is hovered.
        case MenuItemState.CENTER_HOVERED:
          child.setState(MenuItemState.CHILD, -1);
          break;

        // If the center item is not hovered, the child with the given index is hovered.
        case MenuItemState.CENTER:
          if (index == this._activeChildIndex) {
            child.setState(MenuItemState.CHILD_HOVERED, -1);
          } else {
            child.setState(MenuItemState.CHILD, -1);
          }
          break;

        // All children of children become grandchildren.
        case MenuItemState.CHILD:
          child.setState(MenuItemState.GRANDCHILD, -1);
          break;

        // All children of hovered children become hovered grandchildren.
        case MenuItemState.CHILD_HOVERED:
        case MenuItemState.CHILD_DRAGGED:
          child.setState(MenuItemState.GRANDCHILD_HOVERED, -1);
          break;

        // Children of parents are drawn like grandchildren.
        case MenuItemState.PARENT:
          if (index != this._activeChildIndex) {
            child.setState(MenuItemState.GRANDCHILD, -1);
          }
          break;

        // Children of hovered parents are drawn like hovered grandchildren.
        case MenuItemState.PARENT_HOVERED:
          if (index != this._activeChildIndex) {
            child.setState(MenuItemState.GRANDCHILD_HOVERED, -1);
          }
          break;

        // Children of invisible items are invisible as well.
        default:
          child.setState(MenuItemState.INVISIBLE, -1);
      }
    });
  }

  getState() {
    return this._state;
  }

  // This is called once after construction and then whenever something in the appearance
  // settings has changed. This calls itself recursively on the entire menu tree below
  // this MenuItem.
  onSettingsChange(settings) {

    // First we reset the icon members to force their re-creation during the next state
    // change. As many settings affect the icon size or background color, we simply do
    // this in any case. This could be optimized by limiting this to the cases where
    // settings keys were changed which actually affect the icons.
    this._iconContainer.destroy_all_children();
    delete this._iconContainer[MenuItemState.CENTER];
    delete this._iconContainer[MenuItemState.CENTER_HOVERED];
    delete this._iconContainer[MenuItemState.CHILD];
    delete this._iconContainer[MenuItemState.CHILD_HOVERED];
    delete this._iconContainer[MenuItemState.GRANDCHILD];
    delete this._iconContainer[MenuItemState.GRANDCHILD_HOVERED];
    this._forceRecreation = true;

    // Then parse all settings required during the next call to redraw().
    const globalScale = settings.get_double('global-scale');

    // clang-format off
    this._settings = {
      easingDuration:          settings.get_double('easing-duration') * 1000,
      easingMode:              settings.get_enum('easing-mode'),
      textColor:               Clutter.Color.from_string(settings.get_string('text-color'))[1],
      font:                    settings.get_string('font'),
      traceThickness:          settings.get_double('trace-thickness') * globalScale,
      traceColor:              Clutter.Color.from_string(settings.get_string('trace-color'))[1],
      state: new Map ([
        [MenuItemState.INVISIBLE, {
          colorMode:           '',
          size:                0,
          offset:              0,
          iconOpacity:         0,
        }],
        [MenuItemState.CENTER, {
          colorMode:           settings.get_string('center-color-mode'),
          fixedColor:          Clutter.Color.from_string(settings.get_string('center-fixed-color'))[1],
          size:                settings.get_double('center-size')  * globalScale,
          offset:              0,
          iconScale:           settings.get_double('center-icon-scale'),
          iconOpacity:         settings.get_double('center-icon-opacity'),
          autoColorSaturation: settings.get_double('center-auto-color-saturation'),
          autoColorLuminance:  settings.get_double('center-auto-color-luminance'),
          autoColorOpacity:    settings.get_double('center-auto-color-opacity') * 255,
          drawChildrenAbove:   settings.get_boolean('child-draw-above'),
        }],
        [MenuItemState.CENTER_HOVERED, {
          colorMode:           settings.get_string('center-color-mode-hover'),
          fixedColor:          Clutter.Color.from_string(settings.get_string('center-fixed-color-hover'))[1],
          size:                settings.get_double('center-size-hover')  * globalScale,
          offset:              0,
          iconScale:           settings.get_double('center-icon-scale-hover'),
          iconOpacity:         settings.get_double('center-icon-opacity-hover'),
          autoColorSaturation: settings.get_double('center-auto-color-saturation-hover'),
          autoColorLuminance:  settings.get_double('center-auto-color-luminance-hover'),
          autoColorOpacity:    settings.get_double('center-auto-color-opacity-hover') * 255,
          drawChildrenAbove:   settings.get_boolean('child-draw-above'),
        }],
        [MenuItemState.CHILD, {
          colorMode:           settings.get_string('child-color-mode'),
          fixedColor:          Clutter.Color.from_string(settings.get_string('child-fixed-color'))[1],
          size:                settings.get_double('child-size')     * globalScale,
          offset:              settings.get_double('child-offset')   * globalScale,
          iconScale:           settings.get_double('child-icon-scale'),
          iconOpacity:         settings.get_double('child-icon-opacity'),
          autoColorSaturation: settings.get_double('child-auto-color-saturation'),
          autoColorLuminance:  settings.get_double('child-auto-color-luminance'),
          autoColorOpacity:    settings.get_double('child-auto-color-opacity')  * 255,
          drawChildrenAbove:   settings.get_boolean('grandchild-draw-above'),
        }],
        [MenuItemState.CHILD_HOVERED, {
          colorMode:           settings.get_string('child-color-mode-hover'),
          fixedColor:          Clutter.Color.from_string(settings.get_string('child-fixed-color-hover'))[1],
          size:                settings.get_double('child-size-hover')    * globalScale,
          offset:              settings.get_double('child-offset-hover')  * globalScale,
          iconScale:           settings.get_double('child-icon-scale-hover'),
          iconOpacity:         settings.get_double('child-icon-opacity-hover'),
          autoColorSaturation: settings.get_double('child-auto-color-saturation-hover'),
          autoColorLuminance:  settings.get_double('child-auto-color-luminance-hover'),
          autoColorOpacity:    settings.get_double('child-auto-color-opacity-hover') * 255,
          drawChildrenAbove:   settings.get_boolean('grandchild-draw-above'),
        }],
        [MenuItemState.GRANDCHILD, {
          colorMode:           settings.get_string('grandchild-color-mode'),
          fixedColor:          Clutter.Color.from_string(settings.get_string('grandchild-fixed-color'))[1],
          size:                settings.get_double('grandchild-size')    * globalScale,
          offset:              settings.get_double('grandchild-offset')  * globalScale,
          iconOpacity:         0,
          drawAbove:           settings.get_boolean('grandchild-draw-above'),
        }],
        [MenuItemState.GRANDCHILD_HOVERED, {
          colorMode:           settings.get_string('grandchild-color-mode-hover'),
          fixedColor:          Clutter.Color.from_string(settings.get_string('grandchild-fixed-color-hover'))[1],
          size:                settings.get_double('grandchild-size-hover')   * globalScale,
          offset:              settings.get_double('grandchild-offset-hover') * globalScale,
          iconOpacity:         0,
          drawAbove:           settings.get_boolean('grandchild-draw-above'),
        }]
      ]),
    };
    // clang-format on

    // Most of the settings will come into effect during the call to redraw(). However,
    // some caption settings we can apply here as they won't be affected by state changes.
    const captionWidth = this._settings.state.get(MenuItemState.CENTER).size * 0.8;
    this._caption.set_size(captionWidth, captionWidth);
    this._caption.set_color(this._settings.textColor);

    // Multiply the size of the font by globalScale.
    const fontDescription = Pango.FontDescription.from_string(this._settings.font);
    const fontSize        = fontDescription.get_size();
    if (fontDescription.get_size_is_absolute()) {
      fontSize = Pango.units_from_double(fontSize);
    }
    fontDescription.set_size(fontSize * globalScale);
    this._caption.set_font_description(fontDescription);

    // We also re-draw the trace line to the currently active child if there is any.
    if (this._trace != undefined) {
      this._trace.get_content().invalidate();
    }

    // Finally, call this recursively for all children.
    this._childrenContainer.get_children().forEach(
        child => child.onSettingsChange(settings));
  }

  // This updates all parameters (such as position, opacity or colors) of the individual
  // actors of this MenuItem. It is usually called after the setState() above. It
  // automatically calls redraw() on all child MenuItems of this.
  redraw() {

    // PARENT items and PARENT_HOVERED items are drawn like CHILD and CHILD_HOVERED items
    // respectively; *_DRAGGED items are drawn like CHILD_HOVERED items. Therefore we
    // create a variable for the "visual state" which is the same as the _state in all
    // other cases.
    let visualState = this._state;

    if (this._state == MenuItemState.PARENT) {
      visualState = MenuItemState.CHILD;
    } else if (
        this._state == MenuItemState.CHILD_DRAGGED ||
        this._state == MenuItemState.PARENT_HOVERED) {
      visualState = MenuItemState.CHILD_HOVERED;
    }

    // Hide the item completely if invisible.
    this.visible = visualState != MenuItemState.INVISIBLE;

    // The _settings member contains a Map of settings for each MenuItemState.
    const settings = this._settings.state.get(visualState);

    // Depending on the corresponding settings key, raise or lower the child MenuItems
    // of this above or below the background.
    if (visualState != MenuItemState.INVISIBLE) {
      if (settings.drawChildrenAbove) {
        this.set_child_above_sibling(this._childrenContainer, this._iconContainer);
      } else {
        this.set_child_below_sibling(this._childrenContainer, this._iconContainer);
      }
    }

    // If our state is MenuItemState.CENTER, redraw the caption text. Else hide the
    // caption by setting its opacity to zero.
    if (visualState == MenuItemState.CENTER && this._activeChildIndex >= 0) {
      const child = this._childrenContainer.get_children()[this._activeChildIndex];
      this._caption.set_text(child.caption);
      this._caption.set_easing_duration(0);
      const captionHeight = this._caption.get_layout().get_pixel_extents()[1].height;
      this._caption.set_translation(
          Math.floor(-this._caption.width / 2), Math.floor(-captionHeight / 2), 0);
      this._caption.set_easing_duration(this._settings.easingDuration);

      this._caption.opacity = 255;
    } else {
      this._caption.opacity = 0;
    }

    // This easing duration and mode are used for size and position transitions further
    // below. We set the easing duration to zero for the initial call to redraw() in
    // order to avoid animations when the menu shows up.
    let easingDuration = this._firstRedraw ? 0 : this._settings.easingDuration;
    this._firstRedraw  = false;

    this.set_easing_duration(easingDuration);
    this.set_easing_mode(this._settings.easingMode);

    // If our state is some child or grandchild state, set the translation based on the
    // angle and the specified offset. For all other states, the translation is set from
    // the Menu.
    if (this._state == MenuItemState.CHILD ||
        this._state == MenuItemState.CHILD_HOVERED ||
        this._state == MenuItemState.GRANDCHILD ||
        this._state == MenuItemState.GRANDCHILD_HOVERED ||
        this._state == MenuItemState.INVISIBLE) {

      this.set_translation(
          Math.floor(Math.sin(this.angle) * settings.offset),
          -Math.floor(Math.cos(this.angle) * settings.offset), 0);
    }

    // No we compute the background color for the currently visible icon. This will be
    // propagated as parent color to all children.
    let backgroundColor = settings.fixedColor;

    // If the color mode is 'auto', we calculate an average color of the icon.
    if (settings.colorMode == 'auto') {

      // This won't change, so we need to compute it only once.
      if (this._averageIconColor == undefined) {
        const tmp = new Cairo.ImageSurface(Cairo.Format.ARGB32, 24, 24);
        const ctx = new Cairo.Context(tmp);
        utils.paintIcon(ctx, this.icon, 24, 1);

        // We store the average color as a property of this.
        this._averageIconColor = utils.getAverageIconColor(tmp, 24);

        // Explicitly tell Cairo to free the context memory. Is this really necessary?
        // https://wiki.gnome.org/Projects/GnomeShell/Extensions/TipsOnMemoryManagement#Cairo
        ctx.$dispose();
      }

      // Now we modify this color based on luminance and saturation.
      let [h, l, s] = this._averageIconColor.to_hls();

      // First we increase the base luminance to 0.5 so that we do not create pitch black
      // colors.
      l = 0.5 + l * 0.5;

      // Tweak the luminance based on the settings values.
      const lFac = settings.autoColorLuminance * 2 - 1;
      l          = lFac > 0 ? l * (1 - lFac) + 1 * lFac : l * (lFac + 1);

      // We only modify the saturation if it's not too low. Else we will get artificial
      // colors for already quite desaturated icons.
      if (s > 0.1) {
        const sFac = settings.autoColorSaturation * 2 - 1;
        s          = sFac > 0 ? s * (1 - sFac) + 1 * sFac : s * (sFac + 1);
      }

      backgroundColor       = Clutter.Color.from_hls(h, l, s);
      backgroundColor.alpha = settings.autoColorOpacity;

    } else if (settings.colorMode == 'parent') {
      backgroundColor = this._parentColor;
    }

    // If we are in some center- or child- or grandchild-state and have no icon for this
    // state yet, create a new icon! This will also happen after a settings change, as
    // icons are deleted to force a re-creation here.
    if ((visualState == MenuItemState.CENTER ||
         visualState == MenuItemState.CENTER_HOVERED ||
         visualState == MenuItemState.CHILD ||
         visualState == MenuItemState.CHILD_HOVERED ||
         visualState == MenuItemState.GRANDCHILD ||
         visualState == MenuItemState.GRANDCHILD_HOVERED) &&
        this._iconContainer[visualState] == undefined) {

      let icon;
      if (visualState == MenuItemState.CENTER ||
          visualState == MenuItemState.CENTER_HOVERED ||
          visualState == MenuItemState.CHILD ||
          visualState == MenuItemState.CHILD_HOVERED) {
        icon = this._createIcon(
            backgroundColor, settings.size, this.icon, settings.iconScale,
            settings.iconOpacity);
      } else {
        // Grandchildren have only a circle as icon. Therefore no icon name is passed to
        // this method.
        icon = this._createIcon(backgroundColor, settings.size);
      }

      this._iconContainer[visualState] = icon;
      this._iconContainer.add_child(icon);

      // When the settings are modified (especially when a menu is shown
      // in edit mode), the icons are completely reloaded. To make this jitter-free,
      // the _forceRecreation tells us whether we have to load the icon at full opacity.
      icon.set_opacity(this._forceRecreation ? 255 : 0);
      this._forceRecreation = false;
    }

    // Now we update the opacity of the individual icons. Only one icon - the one for the
    // current state - should be visible. There is however, a transition phase were
    // multiple might be visible at the same time.
    const updateOpacity = (state) => {
      const icon = this._iconContainer[state];
      if (icon != undefined) {

        // Set opacity to 255 only for the current state.
        const opacity = visualState == state ? 255 : 0;

        // Use different easing modes when fading out or fading in. If we would use a
        // linear transition, the opacity of two cross-fading icons would not add up to
        // 255. If done like this, it's not correct either but looks very good.
        icon.set_easing_mode(
            icon.opacity > opacity ? Clutter.AnimationMode.EASE_IN_QUAD :
                                     Clutter.AnimationMode.EASE_OUT_QUAD);
        icon.set_easing_duration(easingDuration);
        icon.set_opacity(opacity);
      }
    };

    updateOpacity(MenuItemState.CENTER);
    updateOpacity(MenuItemState.CENTER_HOVERED);
    updateOpacity(MenuItemState.CHILD);
    updateOpacity(MenuItemState.CHILD_HOVERED);
    updateOpacity(MenuItemState.GRANDCHILD);
    updateOpacity(MenuItemState.GRANDCHILD_HOVERED);

    // Now update the size of the icon container. As there is a layout manager in action,
    // all icons will update their size accordingly.
    this._iconContainer.set_easing_duration(easingDuration);
    this._iconContainer.set_easing_mode(this._settings.easingMode);

    const size2 = Math.floor(settings.size / 2);
    this._iconContainer.set_translation(-size2, -size2, 0);
    this._iconContainer.set_size(100, 100);
    this._iconContainer.set_scale(settings.size / 100, settings.size / 100);


    this.redrawTrace();


    // Finally call redraw() recursively on all children.
    if (visualState != MenuItemState.INVISIBLE) {
      this._childrenContainer.get_children().forEach(child => {
        child.setParentColor(backgroundColor);
        child.redraw();
      });
    }
  }

  // While implementing this trace segment visualization I ran into several Clutter
  // issues. Therefore the code below is more complicated than it should be.
  // * button release not firing when _trace width is set (or any other
  // allocation-changing property as it seems)
  // * trace length not animated to final value
  redrawTrace() {
    // Now update the trace line to the currently active child if we are a PARENT*.
    if (this._state == MenuItemState.PARENT ||
        this._state == MenuItemState.PARENT_HOVERED) {

      // We need to create the _trace actor if it's not there yet.
      if (this._trace == undefined) {
        this._traceContainer = new Clutter.Actor();
        this._trace          = new Clutter.Actor({width: 1});

        const canvas = new Clutter.Canvas();
        canvas.connect('draw', (canvas, ctx, width, height) => {
          ctx.setOperator(Cairo.Operator.CLEAR);
          ctx.paint();
          ctx.setOperator(Cairo.Operator.OVER);

          // Simply draw a line in the middle of the canvas from left to right.
          ctx.setSourceRGBA(
              this._settings.traceColor.red / 255, this._settings.traceColor.green / 255,
              this._settings.traceColor.blue / 255,
              this._settings.traceColor.alpha / 255);
          ctx.setLineWidth(this._settings.traceThickness);
          ctx.moveTo(0, height / 2);
          ctx.lineTo(width, height / 2);
          ctx.stroke();

          // Explicitly tell Cairo to free the context memory. Is this really necessary?
          ctx.$dispose();
        });

        this._trace.set_content(canvas);
        this.insert_child_below(this._traceContainer, null);
        this._traceContainer.add_child(this._trace);
      }

      // First we update the trace's thickness (if the settings changed) and its rotation.
      // For this we do not want animations. We add on pixel padding on each side to get
      // smooth antialiasing.
      if (this._trace.get_height() != this._settings.traceThickness + 2) {
        this._trace.set_height(this._settings.traceThickness + 2);
        this._trace.set_translation(0, -this._trace.get_height() / 2, 0);
        this._trace.get_content().set_size(1, this._settings.traceThickness + 2);
      }

      // Fade-in the trace it it's currently invisible.
      this._trace.set_easing_duration(this._settings.easingDuration);
      this._trace.set_easing_mode(Clutter.AnimationMode.LINEAR);
      this._trace.set_opacity(255);
      this._trace.set_easing_mode(this._settings.easingMode);

      // Now we calculate the desired length by computing the distance to the currently
      // active child.
      const child = this._childrenContainer.get_children()[this._activeChildIndex];
      let x       = child.translation_x;
      let y       = child.translation_y;

      const tx = child.get_transition('translation-x');
      const ty = child.get_transition('translation-y');

      if (tx) x = tx.interval.final;
      if (ty) y = ty.interval.final;

      // Now set the width to the child's distance.
      this._trace.set_scale(Math.sqrt(x * x + y * y), 1);

      // Then update the direction.
      let targetAngle = Math.atan2(y, x) * 180 / Math.PI;
      if (targetAngle - this._traceContainer.rotation_angle_z > 180) {
        targetAngle -= 360;
      }
      if (targetAngle - this._traceContainer.rotation_angle_z < -180) {
        targetAngle += 360;
      }
      this._traceContainer.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, targetAngle);

    } else if (this._trace != undefined) {

      // If we are no PARENT, but have a trace, make it invisible so that we can use it
      // later again.
      this._trace.set_easing_duration(this._settings.easingDuration);
      this._trace.set_easing_mode(Clutter.AnimationMode.LINEAR);
      this._trace.set_opacity(0);
      this._trace.set_easing_mode(this._settings.easingMode);
      this._trace.set_scale(1, 1);
    }
  }

  // This creates a Clutter.Actor with an attached Clutter.Canvas containing an image of
  // this MenuItem's icon.
  _createIcon(backgroundColor, backgroundSize, iconName, iconScale, iconOpacity) {
    const canvas = new Clutter.Canvas({height: backgroundSize, width: backgroundSize});
    canvas.connect('draw', (c, ctx, width, height) => {
      // Clear any previous content.
      ctx.setOperator(Cairo.Operator.CLEAR);
      ctx.paint();

      // Paint the background!
      ctx.setOperator(Cairo.Operator.OVER);
      ctx.save();
      ctx.scale(width, height);
      ctx.translate(0.5, 0.5);
      ctx.arc(0, 0, 0.5, 0, 2.0 * Math.PI);
      ctx.setSourceRGBA(
          backgroundColor.red / 255, backgroundColor.green / 255,
          backgroundColor.blue / 255, backgroundColor.alpha / 255);
      ctx.fill();
      ctx.restore();

      // Paint the icon!
      if (iconName != undefined) {
        const iconSize = backgroundSize * iconScale;
        ctx.translate((backgroundSize - iconSize) / 2, (backgroundSize - iconSize) / 2);
        utils.paintIcon(ctx, iconName, iconSize, iconOpacity);
      }

      // Explicitly tell Cairo to free the context memory. Is this really necessary?
      // https://wiki.gnome.org/Projects/GnomeShell/Extensions/TipsOnMemoryManagement#Cairo
      ctx.$dispose();
    });

    // Trigger initial 'draw' signal emission.
    canvas.invalidate();

    // Create a new actor and set the icon canvas to be its content.
    const actor = new Clutter.Actor();
    actor.set_content(canvas);
    actor.set_x_expand(true);
    actor.set_y_expand(true);

    return actor;
  }
});
