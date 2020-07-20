//////////////////////////////////////////////////////////////////////////////////////////
//   _____       _             _____ _                                                  //
//  |   __|_ _ _|_|___ ___ ___|  _  |_|___   This software may be modified and distri-  //
//  |__   | | | | |   | . |___|   __| | -_|  buted under the terms of the MIT license.  //
//  |_____|_____|_|_|_|_  |   |__|  |_|___|  See the LICENSE file for details.          //
//                    |___|                                                             //
//////////////////////////////////////////////////////////////////////////////////////////

'use strict';

//////////////////////////////////////////////////////////////////////////////////////////
// There are two ways to use Swing-Pie's D-Bus interface.                               //
//                                                                                      //
// 1: Use ShowMenu() or PreviewMenu() to open one of the menus configured in the        //
//    settings dialog of Swing-Pie. As an argument the name of the desired menu must be //
//    provided. The returned integer may be negative, indicating that an error          //
//    occurred. See DBusInterface.errorCodes for possible values.                       //
//                                                                                      //
// 2: Use ShowCustomMenu() or PreviewCustomMenu() to open a completely self-defined     //
//    menu. As argument a menu description has to be provided. This is a JSON string    //
//    like this:                                                                        //
//                                                                                      //
//     {                                                                                //
//      'name':'Menu Name',                                                             //
//      'icon':'icon-name-or-path',                                                     //
//      'children':[{                                                                   //
//        'name':'Item Title 1',                                                        //
//        'icon':'icon-name-or-path',                                                   //
//        'children':[{                                                                 //
//            'name':  'Item Title 11',                                                 //
//            'icon':  'icon-name-or-path',                                             //
//            'angle': 90                                                               //
//          },{                                                                         //
//            'name':  'Item Title 12',                                                 //
//            'icon':  'icon-name-or-path',                                             //
//            'angle': 270                                                              //
//        }]},{                                                                         //
//          'name': 'Item Title 2',                                                     //
//          'icon': 'icon-name-or-path'                                                 //
//        },{                                                                           //
//          'name': 'Item Title 3',                                                     //
//          'icon': 'icon-name-or-path'                                                 //
//        }]                                                                            //
//      }                                                                               //
//                                                                                      //
//    The returned integer is either negative (the server failed to parse the provided  //
//    description) or a positive ID which will be passed to the signals of the          //
//    interface. There are two signals; OnCancel will be fired when the user aborts the //
//    selection in a menu, OnSelect is activated when the user makes a selection. Both  //
//    signals send the ID which has been reported by the corresponding ShowMenu call,   //
//    in addition OnSelect sends the path to the selected item. Like this: '/0/1'.      //
//    There are some further examples on how to use this interface in the README.md.    //
//                                                                                      //
// ShowMenu() and ShowCustomMenu() both show the menu in fullscreen, PreviewMenu() and  //
// PreviewCustomMenu() will only cover half the screen in order to allow for            //
// interaction with settings dialog.                                                    //
//////////////////////////////////////////////////////////////////////////////////////////

var DBusInterface = {
  description:
      '<node>                                                                            \
        <interface name="org.gnome.Shell.Extensions.swingpie">                           \
          <method name="ShowMenu">                                                       \
            <arg name="name" type="s" direction="in"/>                                   \
            <arg name="id"   type="i" direction="out"/>                                  \
          </method>                                                                      \
          <method name="PreviewMenu">                                                    \
            <arg name="name" type="s" direction="in"/>                                   \
            <arg name="id"   type="i" direction="out"/>                                  \
          </method>                                                                      \
          <method name="ShowCustomMenu">                                                 \
            <arg name="description" type="s" direction="in"/>                            \
            <arg name="id"          type="i" direction="out"/>                           \
          </method>                                                                      \
          <method name="PreviewCustomMenu">                                              \
            <arg name="description" type="s" direction="in"/>                            \
            <arg name="id"          type="i" direction="out"/>                           \
          </method>                                                                      \
          <signal name="OnSelect">                                                       \
              <arg name="id"   type="i"/>                                                \
              <arg name="path" type="s"/>                                                \
          </signal>                                                                      \
          <signal name="OnCancel">                                                       \
              <arg name="id" type="i"/>                                                  \
          </signal>                                                                      \
      </interface>                                                                       \
    </node>',

  // The Show* and Preview* methods of the D-Bus interface all return a positive menu ID.
  // If a negative number is returned, an error occurred. The possible error values are
  // listed below.
  errorCodes: {
    eUnknownError: -1,
    eAlreadyActive: -2,
    eInvalidJSON: -3,
    eInvalidAngles: -4,
    eNoSuchMenu: -5,
  },

  // This can be used to translate an error code to a human-readable message.
  getErrorDescription: (code) => {
    switch (code) {
      case -2:
        return 'A menu is already opened; try again later.';
      case -3:
        return 'The provided menu description was no valid JSON.';
      case -4:
        return 'The angles of the children did not follow the rules.';
      case -5:
        return 'No menu with this name exists.';
      default:
        return 'An unknown error occurred.';
    }
  }
};