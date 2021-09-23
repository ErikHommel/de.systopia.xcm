<?php
/*-------------------------------------------------------+
| Extended Contact Matcher XCM                           |
| Copyright (C) 2021 SYSTOPIA                            |
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

use CRM_XCM_ExtensionUtil as E;

/**
 * This analyser will use the XCM's facilities to get or create a contact based on the contact
 *   data in the transaction - typically
 */
class CRM_Banking_PluginImpl_Matcher_GetOrCreateContactAnalyser extends CRM_Banking_PluginModel_Analyser {

  const FIRST_NAME_CACHE_KEY = 'banking_xcm_analyser_db_first_name_list';
  const FIRST_NAME_CACHE_TTL = 60 * 60 * 24 * 7; // one week

  /**
   * Contact Get-Or-Create Analyser. Configuration options:
   *   'xcm_profile':
   *       the name of the xcm_profile to use. leave empty for the default profile
   *
   *   'name_mode'
   *       how should the first name and last name be separated from the 'name' field. options are:
   *       'first': first part of the name (separated by blanks) is the first name, the rest is last name (default)
   *       'last':  last part of the name (separated by blanks) is the last name, the rest is first name
   *       'off':   no name extraction is done, you would then have to use a mapping to get the fields used for your
     *                xc_ profile
   *       'db':    if the first part is already in the database as a first_name, use that as first name,
   *                  otherwise use same as 'last'
   *
   *   'contact_type':
   *       contact type to be passed to XCM. Default is 'Individual'. Can be overridden by the mapping
   *
   *   'mapping':
   *       array mapping (propagation) values to the values passed to the XCM
   *
   *   'output_field':
   *       field to which the resulting contact ID is written. Default is 'contact_id'
   */
  function __construct($config_name) {
    parent::__construct($config_name);

    // read config, set defaults
    $config = $this->_plugin_config;
    if (!isset($config->xcm_profile))   $config->xcm_profile  = null; // i.e. default
    if (!isset($config->name_mode))     $config->name_mode    = 'first';
    if (!isset($config->contact_type))  $config->contact_type = 'Individual';
    if (!isset($config->mapping))       $config->mapping      = [];
    if (!isset($config->output_field))  $config->output_field = 'contact_id';
  }

  /**
   * Run the analyser
   */
  public function analyse(CRM_Banking_BAO_BankTransaction $btx, CRM_Banking_Matcher_Context $context) {
    $config = $this->_plugin_config;

    // You can control/restrict the execution with the required values - just like a matcher
    if (!$this->requiredValuesPresent($btx)) return null;

    // start compiling the values
    $xcm_values = [
        'xcm_profile'  => $config->xcm_profile,
        'contact_type' => $config->contact_type,
    ];

    // step 1: get the first/last name
    $this->applyNameExtraction($btx, $xcm_values, $config->name_mode);

    // step 2: apply mapping
    $this->applyMapping($btx, $xcm_values, $config->mapping);

    // step 3: run XCM
    $contact_id = $this->runXCM($btx, $xcm_values);
    $this->logMessage("Contact identified by XCM: " . $contact_id, 'debug');

    // step 4: apply contact ID
    if ($contact_id) {
      $data_parsed = $btx->getDataParsed();
      if (!isset($data_parsed[$config->output_field]) || $data_parsed[$config->output_field] != $contact_id) {
        $data_parsed[$config->output_field] = $contact_id;
        $btx->setDataParsed($data_parsed);
        $this->logMessage("Update field {$config->output_field} with: " . $contact_id, 'debug');
      }
    }
  }

  /**
   * Apply the current mapping of btx parameters to the xcm values
   *
   * @param CRM_Banking_BAO_BankTransaction $btx
   *     the current transaction
   * @param string $xcm_profile
   *     the xcm profile to use
   * @param array $xcm_values
   *     values to be passed to the xcm
   *
   * @return integer
   *     contact ID
   */
  protected function runXCM($btx, $xcm_values)
  {
    // first add some config values
    $config = $this->_plugin_config;
    if (!isset($xcm_values['xcm_profile'])) {
      $xcm_values['xcm_profile'] = $config->xcm_profile;
    }
    if (!isset($xcm_values['contact_type'])) {
      $xcm_values['contact_type'] = $config->contact_type;
    }

    try {
      $xcm_result = civicrm_api3('Contact', 'getorcreate', $xcm_values);
      return $xcm_result['id'];
    } catch (CiviCRM_API3_Exception $ex) {
      $this->logMessage('XCM call failed with ' . $ex->getMessage() . ' Parameters were: ' . json_encode($xcm_values), 'error');
      return null;
    }
  }

  /**
   * Apply the current mapping of btx parameters to the xcm values
   *
   * @param CRM_Banking_BAO_BankTransaction $btx
   *     the current transaction
   * @param array $xcm_values
   *     the current list of values to be passed to XCM to be extended
   * @param array $mapping
   *     one of the name modes, see above
   */
  protected function applyMapping($btx, &$xcm_values, $mapping)
  {
    foreach ($mapping as $from_field => $to_field) {
      $xcm_values[$to_field] = $this->getPropagationValue($btx, NULL, $from_field);
    }
  }

  /**
   * Apply the selected name extraction mode to get first_name, last_name
   *
   * @param CRM_Banking_BAO_BankTransaction $btx
   *     the current transaction
   * @param array $xcm_values
   *     the current list of values to be passed to XCM to be extended
   * @param $name_mode
   *     one of the name modes, see above
   */
  protected function applyNameExtraction($btx, &$xcm_values, $name_mode)
  {
    $btx_name = $btx->getDataParsed()['name'] ?? '';
    $name_bits = preg_split('/ +/', $btx_name);
    $this->logMessage("Extracting names from '{$btx_name}', mode is '{$name_mode}'", 'debug');

    switch ($name_mode) {
      case 'first':
        $xcm_values['first_name'] = $name_bits[0] ?? '';
        if (count($name_bits) > 1) {
          array_pop($name_bits);
          $xcm_values['last_name'] = implode(' ', $name_bits);
        }
        break;

      case 'last':
        $xcm_values['last_name'] = $name_bits[0] ?? '';
        if (count($name_bits) > 1) {
          array_pop($name_bits);
          $xcm_values['first_name'] = implode(' ', $name_bits);
        }
        break;

      case 'db':
        $first_names = [];
        $last_names = [];
        foreach ($name_bits as $name_bit) {
          if ($this->isDBFirstName($name_bit)) {
            $first_names[] = $name_bit;
          } else {
            $last_names[] = $name_bit;
          }
        }
        $this->logMessage("Identified (by DB) first names of '{$btx_name}' are: " . implode(',', $first_names), 'debug');
        $xcm_values['first_name'] = implode(' ', $first_names);
        $xcm_values['last_name'] = implode(' ', $last_names);
        break;

      default:
      case 'off':
        break;
    }
  }


  /**
   * Check if the given string appears in the first_name column in the database
   *
   * @param $name string
   *  the name sample
   */
  public function isDBFirstName($name) {
    static $all_first_names = null;
    if ($all_first_names === null) {
      $all_first_names = CRM_Core_BAO_Cache::getItem('civibanking', 'plugin/analyser_xcm');
      if ($all_first_names === null) {
        // load all first names from the database
        $all_first_names = [];
        $this->logger->setTimer('load_first_names');
        $data = CRM_Core_DAO::executeQuery("SELECT DISTINCT(LOWER(first_name)) AS name FROM civicrm_contact WHERE is_deleted = 0;");
        while ($data->fetch()) {
          $all_first_names[$data->name] = 1;
        }
        $this->logTime("Loading all first names", 'load_first_names');
        CRM_Core_BAO_Cache::setItem($all_first_names,'civibanking', 'plugin/analyser_xcm');
      }
    }

    // now simply
    return isset($all_first_names[$name]);
  }

  /**
   * Register this module IF CiviBanking is installed and detected
   */
  public static function registerModule()
  {
    if (function_exists('banking_civicrm_install_options')) {
      // extension is enabled, let's see if our module is there
      $exists = civicrm_api3('OptionValue', 'getcount', [
          'option_group_id' => 'civicrm_banking.plugin_types',
          'value' => 'CRM_Banking_PluginImpl_Matcher_GetOrCreateContactAnalyser'
      ]);
      if (!$exists) {
        // register new item
        civicrm_api3('OptionValue', 'create', [
            'option_group_id' => 'civicrm_banking.plugin_types',
            'value' => 'CRM_Banking_PluginImpl_Matcher_GetOrCreateContactAnalyser',
            'label' => E::ts('Create Contact Analyser (XCM)'),
            'name' => 'analyser_xcm',
            'description' => E::ts("Uses XCM to create a potentially missing contact before reconciliation."),
        ]);
        CRM_Core_Session::setStatus(
            E::ts("Registered new XCM CiviBanking module 'Create Contact Analyser'"),
            E::ts("Registered CiviBanking Module!"),
            'info');
      }
    }
  }
}
