/*-------------------------------------------------------+
| Extended Contact Matcher XCM                           |
| Copyright (C) 2016 SYSTOPIA                            |
| Author: B. Endres (endres@systopia.de)                 |
+--------------------------------------------------------+
| This program is released as free software under the    |
| Affero GPL license. You can redistribute it and/or     |
| modify it under the terms of this license which you    |
| can read by viewing the included agpl.txt or online    |
| at www.gnu.org/licenses/agpl.html. Removal of this     |
| copyright header is strictly prohibited without        |
| written permission from the original author(s).        |
+--------------------------------------------------------*/

/**
 * This function will be executed after the activity is loaded
 * and perform all the changes necessary
 */
CRM.$(function() {

  // gather some data
  var ACTIVITY_TARGET_CONTACT_ID = CRM.$('input[name="source_contact_id"').val();
  
  var outer_table   = CRM.$('table.crm-info-panel');
  var details       = outer_table.find('tr.crm-activity-form-block-details td.view-value');
  var address_table = details.find('table');
  
  // add an extra table column, if not there yet...
  address_table.find('tbody tr').each(function(i) {
    var tr = CRM.$(this);
    var column_exists      = (tr.find('#mh_field_' + i).length > 0);
    var faulty_template    = (tr.find('[id^="mh_field_"]').length > 1);
    var contains_response  = (['überschrieben', 'hinzugefügt'].indexOf(tr.find('#mh_field_' + i).text()) > -1);
    var contains_old_value = (tr.children(':nth-child(2)').text().length > 0);
    var contains_new_value = (tr.children(':nth-child(3)').text().length > 0);
    var attribute          = tr.children(':nth-child(1)').text();
    if (faulty_template) {
      console.log('row ' + i + ' is faulty! stopping.');
      return;
    }

    // change header (2) title
    address_table.find('thead tr').children(':nth-child(2)').text("alter Wert");

    // add buttons, if this hasn't been processed yet
    if (!contains_response) {
      // add our colum if not there yet
      if (!column_exists) {
        tr.append('<td class="mh_btn_row" id="mh_field_' + i + '">');
      }

      var attribute_class = getAttributeClass(attribute);

      // add UPDATE button
      if (   (attribute_class == 'contact' && contains_new_value)
          || (attribute_class == 'phone'   && contains_new_value && contains_old_value)
          || (attribute_class == 'address' && contains_new_value && contains_old_value)) 
      {
        // FIXME: l10n
        tr.find('#mh_field_' + i).append('<button type="button" class="mh_ov_button" id="mh_ov_btn_' + i + '">Überschreiben</button>');
      }

      // add ADD button
      if (   (attribute_class == 'phone'   && contains_new_value))
      {
        // FIXME: l10n
        tr.find('#mh_field_' + i).append('<button type="button" class="mh_ad_button" id="mh_ad_btn_' + i + '">Hinzufügen</button>');
      }
    }
  });

  // add button to table header, if the address is complete
  var address_data = getAddressData('new', true);
  if (address_data) {
    address_table.find('thead').append(
      '<button type="button" class="mh_ad_address_btn">Neue Adresse hinzufügen</button>'
    );    
  }

  // add 'complete' button (after all AJAX calls finished)
  cj.ajax({
    context: document.body,
    success: function(){
      cj("div.ui-dialog-buttonset").append('<button id="mh_uimods_complete" class="ui-button ui-widget ui-state-default ui-corner-all ui-button-text-icon-primary" type="button" role="button"><span class="ui-button-icon-primary ui-icon ui-icon-check"></span><span class="ui-button-text">Abschließen</span></button>');
      cj('#mh_uimods_complete').click(completeActivity);
    }
  });

  // add button handlers
  address_table.find('.mh_ov_button').click(dispatchClick);
  address_table.find('.mh_ad_button').click(dispatchClick);
  address_table.find('.mh_ad_address_btn').click(dispatchClick);




  /*-------------------------------------------------------+
  | Workflow functions                                     |
  +--------------------------------------------------------*/

  function dispatchClick() {
    // find and disable button
    var btn = CRM.$(this);
    btn.prop("disabled", true);

    // the data object will be handed down the chain of handlers
    var data = {'button': btn};

    // DISPATCH event to the handlers:
    if (btn.hasClass("mh_ad_address_btn")) {
      // ADD (WHOLE) ADDRESS:
      addAddress(data);
    
    } else {
      // this is a button related to an individual row
      data['attribute']  = btn.parent().parent().children(':nth-child(1)').text();
      data['left']       = btn.parent().parent().children(':nth-child(2)').text();
      data['right']      = btn.parent().parent().children(':nth-child(3)').text();
      data['old']        = data['left'];
      data['new']        = data['right'];
      data['modus']      = (btn.hasClass("mh_ov_button")?'edit':'add');
      data['attributes'] = [];

      var command = getAttributeClass(data['attribute']) + '-' + data['modus'];

      switch (command) {
        case 'phone-edit':
          editPhone(data);
          break;
        case 'phone-add':
          addPhone(data);
          break;
        case 'contact-edit':
          editContact(data);
          break;
        case 'address-edit':
          editAddress(data);
          break;
        default:
          console.log('attribute/action is not supported: ' + data['attribute']);
      }
    }
  }

  // simply set activity to "Complete" and click "close"
  function completeActivity() {
    // save changes
    CRM.api3('Activity', 'create', {
      'id': CRM.vars['org.muslimehelfen.uimods'].targetActivityId,
      'status_id': 2 // Complete
    }).done(
      function(result) {
        if (result.is_error) {
          onError(result.error_message, null);
        } else {
          var activity_id = CRM.vars['org.muslimehelfen.uimods'].targetActivityId;
          cj("#rowid" + activity_id + " td:nth-child(8)").text("Abgeschlossen");
          cj("button[data-identifier=_qf_Activity_cancel]").click();
        }
      }
    );    
  }



  /**
   * HANDLER: edit an existing phone
   */
  function editPhone(data) {
    // we need both, old and new value to override
    if (data['old'].length == 0) {
      onError('Die alte Telefonnummer zum überschreiben kann nicht identifiziert werden. Bitte mit "hinzufügen" versuchen.', null);
      return;
    }
    if (data['new'].length == 0) {
      onError('Keine neue Telefonnummer angegeben.', null);
      return;
    }

    // get type ids
    var location_type_id = CRM.vars['org.muslimehelfen.uimods'].location_type_private_address;
    var phone_type_id    = ((data['attribute'] == 'phone') ?
      CRM.vars['org.muslimehelfen.uimods'].phone_type_phone_value :
      CRM.vars['org.muslimehelfen.uimods'].phone_type_mobile_value);

    // lookup phone with the old phone number
    CRM.api3('Phone', 'getsingle', {
      'contact_id':       ACTIVITY_TARGET_CONTACT_ID,
      'phone':            data['old'],
      'phone_type_id':    phone_type_id,
      'location_type_id': location_type_id,
    }).done(function(result) {
      if (result.is_error) {
        return onError("Die alte Telefonnummer konnte nicht gefunden werden, vermutlich wurde sie zwischenzeitlich geändert oder gelöscht. Automatisches Überschreiben leider nicht möglich.", null);
      } else {
        // hand the result to the update handler
        updatePhone(data, result);
      }
    });
  }


  /**
   * HANDLER: add a new phone entry
   */
  function addPhone(data) {
    // pseudo-constants
    var location_type_id = CRM.vars['org.muslimehelfen.uimods'].location_type_private_address;
    var phone_type_id    = ((data['attribute'] == 'phone') ?
      CRM.vars['org.muslimehelfen.uimods'].phone_type_phone_value :
      CRM.vars['org.muslimehelfen.uimods'].phone_type_mobile_value);

    // aggregate the gathered data
    var phone_data = {};
    phone_data['contact_id']       = ACTIVITY_TARGET_CONTACT_ID;
    phone_data['phone']            = data['new'];
    phone_data['is_primary']       = 1;
    phone_data['phone_type_id']    = phone_type_id;
    phone_data['location_type_id'] = location_type_id;

    // save changes
    CRM.api3('Phone', 'create', phone_data).done(function(result) {
      if (result.is_error) {
        onError(result.error_message, null);
      } else {
        updateActivity(data);
      }
    });
  }


  /**
   * HANDLER: edit a contact
   */
  function editContact(data) {
    // look up data (like prefix->prefix_id)
    var request   = lookup(data['attribute'], data['new']);
    request['id'] = ACTIVITY_TARGET_CONTACT_ID;

    // save changes
    CRM.api3('Contact', 'create', request).done(function(result) {
      if (result.is_error) {
        onError(result.error_message, null);
      } else {
        updateActivity(data);
      }
    });
  }

  /**
   * HANDLER: edit an address
   */
  function editAddress(data) {
    address_data = getAddressData('current', false);
    address_data['contact_id'] = ACTIVITY_TARGET_CONTACT_ID;

    // lookup address with the old data
    CRM.api3('Address', 'getsingle', address_data).done(function(result) {
      if (result.is_error) {
        return onError("Die alte Addresse konnte nicht gefunden werden, vermutlich wurde sie zwischenzeitlich geändert oder gelöscht. Automatisches Überschreiben leider nicht möglich.", null);
      } else {
        // hand the result to the update handler
        updateAddress(data, result);
      }
    });
  }

  /**
   * HANDLER: add a new address
   */
  function addAddress(data) {
    address_data = getAddressData('new', true);
    if (!address_data) {
      onError('Die Adressdaten sind nicht ausreichend für das Anlegen einer neuen Adresse.', null);
      return;
    }

    // create address request
    address_data['location_type_id'] = CRM.vars['org.muslimehelfen.uimods'].location_type_private_address;
    address_data['contact_id'] = ACTIVITY_TARGET_CONTACT_ID;
    address_data['is_primary'] = 1;

    // lookup address with the old data
    CRM.api3('Address', 'create', address_data).done(function(result) {
      if (result.is_error) {
        return onError(result.error_message, null);
      } else {
        // next step is to demote the old address
        findOldAddress(data, result);
      }
    });
  }



  /**
   * SUB-HANDLER: after adding the new address, identify the old one
   */
  function findOldAddress(data) {
    address_data = getAddressData('current', false);
    if (!address_data) {
      // there is no old address => that's it
      return updateActivity(data);
    
    } else {
      // find the old address
      // address_data['location_type_id'] = CRM.vars['org.muslimehelfen.uimods'].location_type_private_address;
      address_data['contact_id'] = ACTIVITY_TARGET_CONTACT_ID;

      // lookup address with the old data
      CRM.api3('Address', 'getsingle', address_data).done(function(result) {
        if (result.is_error) {
          return onError("Die bisherige Primär-Addresse konnte nicht indentifiziert werden, vermutlich wurde sie zwischenzeitlich geändert oder gelöscht. Automatische Markierung als 'alt' leider nicht möglich.", null);
        } else {
          // next step is to add the new address
          demoteOldAddress(data, result);
        }
      });
    }
  }

  /**
   * SUB-HANDLER: demote the old address to 'old'
   */
  function demoteOldAddress(data, address_data) {
    // lookup address with the old data
    CRM.api3('Address', 'create', {
      'id': address_data.id,
      'is_primary': 0,
      'location_type_id': CRM.vars['org.muslimehelfen.uimods'].location_type_old_address
    }).done(function(result) {
      if (result.is_error) {
        return onError("Die alte Adresse konnte nicht automatisch als 'alt' markiert werden.", null);
      } else {
        // next step is to add the new address
        data['attributes'] = ['street_address', 'city', 'postal_code', 'country'];
        updateActivity(data);
      }
    });
  }


  /**
   * SUB-HANDLER: update an existing phone
   */
  function updatePhone(data, phone_data) {
    // update phone
    CRM.api3('Phone', 'create', {
      'id':     phone_data.id,
      'phone':  data['new'],
    }).done(function(result) {
      if (result.is_error) {
        return onError(result.error_message, null);
      } else {
        // hand the result to the update handler
        updateActivity(data);
      }
    });
  }


  /**
   * SUB-HANDLER: update table after done
   */
  function updateActivity(data) {
    // FIXME: l10n
    var title = ((data['modus'] == 'edit') ? 'überschrieben' : 'hinzugefügt');


    // remove buttons and store result ("überschrieben" or "hinzugefügt")
    address_table.find('tr').each(function(i) {
      var row = CRM.$(this);
      var attribute = row.children(':nth-child(1)').text();
      var btn_row   = row.children('td.mh_btn_row');

      if (  attribute == data['attribute'] 
         || data['attributes'].indexOf(attribute) > -1) {
        btn_row.empty();
        btn_row.append(title);
      }
    });

    var divContent = details.find('span.crm-frozen-field').clone();
    divContent.find('table tr td.mh_btn_row').each(clean);
    divContent = divContent.html();

    // prepare object
    var patch = {};
    patch['id'] = CRM.vars['org.muslimehelfen.uimods'].targetActivityId;
    patch['details'] = divContent;

    // save changes
    CRM.api3('Activity', 'create', patch).done(
      function(result) {
        if (result.is_error) {
          onError(result.error_message, null);
        } else {
          CRM.alert('Wert gespeichert', 'Erfolg', 'success');
        }
      }
    );
  }


  /**
   * SUB-HANDLER: update an address
   */
  function updateAddress(data, result) {
    // use the old data..
    address_data       = getAddressData('current', false);
    address_data['id'] = result.id;

    // ..but change the one attribute
    address_data[data['attribute']] = data['new'];

    // save changes
    CRM.api3('Address', 'create', address_data).done(function(result) {
      if (result.is_error) {
        onError(result.error_message, null);
      } else {
        updateActivity(data);
      }
    });
  }









  /*-------------------------------------------------------+
  | Helper functions                                       |
  +--------------------------------------------------------*/

  /**
   * handle Errors that occurred during workflow
   */
  function onError(message, metadata) {
    CRM.alert(message, 'Fehler', 'error');
  }

  /**
   * get the attribute classe ('phone', 'address', 'contact') 
   * from the attribute name
   */
  function getAttributeClass(attribute_name) {
    switch (attribute_name) {
      case 'street_address':
      case 'city':
      case 'postal_code':
      case 'country':
        return 'address';
      case 'phone':
      case 'mobile':
        return 'phone';
      case 'last_name':
      case 'first_name':
      case 'gender':
      case 'prefix':
        return 'contact';
      default:
        return 'invalid';
    }
  }

  /*
   * Clears html content of an element if it contains anything except
   * valid response values ("überschrieben"/"hinzugefügt")
   */
  function clean() {
    var td = CRM.$(this);
    var is_occupied = (td.length > 0);
    // TODO: l10n
    var contains_response = (['überschrieben', 'hinzugefügt'].indexOf(td.text()) > -1);
    if (is_occupied && !contains_response) {
      td.empty();
    }
    td.parent().parent().parent().parent().find('.mh_ad_address_btn').remove();
  }

  /*
   * some values need to be resolved
   */
  function lookup(name, value) {
    if (name == 'gender') {
      if (parseInt(value, 10) > 0) {
        // legacy: sometimes, it's still the gender_id
        return {'gender_id': parseInt(value, 10)};
      } else {
        var gender_map = CRM.vars['org.muslimehelfen.uimods'].gender_names;
        return {'gender_id': gender_map[value]};        
      }
    
    } else if (name == 'prefix') {
      var prefix_map = CRM.vars['org.muslimehelfen.uimods'].prefix_names;
      return {'prefix_id': prefix_map[value]};
    
    } else if (name == 'country') {
      var country_map = CRM.vars['org.muslimehelfen.uimods'].country_names;
      return {'country_id': country_map[value]};
    
    } else {
      return {name: value};
    }
  }

  /**
   * Get the address data from the form. Three modes:
   * 'new'     - only the new values
   * 'old'     - only the old values
   * 'current' - old values, unless already updated with new ones
   */
  function getAddressData(mode, complete_or_nothing) {
    // iterate through all rows and collect the address data
    var address_data = {};
    address_table.find('tr').each(function(i) {
      var row = CRM.$(this);
      var attribute = row.children(':nth-child(1)').text();
      var old_value = row.children(':nth-child(2)').text();
      var new_value = row.children(':nth-child(3)').text();

      if ('address' == getAttributeClass(attribute)) {
        if (mode == 'new') {
          address_data[attribute] = new_value;
        } else if (mode == 'old') {
          address_data[attribute] = old_value;
        } else if (mode == 'current') {
          // now this depends on whether this attribute was already updated
          // FIXME: l10n
          if ('überschrieben' == row.children('td.mh_btn_row').text()) {
            address_data[attribute] = new_value;
          } else {
            address_data[attribute] = old_value;
          }
        }
      }
    });

    // look up country
    if ('country' in address_data) {
      tuple = lookup('country', address_data['country']);
      for (var key in tuple) {
        address_data[key] = tuple[key];
      }
    }

    // if complete_or_nothing, check if all madatory attributes are present
    if (complete_or_nothing) {
      var mandatory_attributes = ['street_address', 'city', 'postal_code', 'country_id'];
      for (var i = mandatory_attributes.length - 1; i >= 0; i--) {
        if (!(mandatory_attributes[i] in address_data)) {
          return null;
        }
      };
    }
    return address_data;
  } 


}); // end of wrapper function