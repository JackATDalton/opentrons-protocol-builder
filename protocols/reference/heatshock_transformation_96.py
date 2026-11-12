from opentrons import protocol_api
import requests
from itertools import groupby
from operator import itemgetter
#function for Slack notification
# Set to "<@YOUR_MEMBER_ID>" to be tagged in this run's alerts.
# Slack profile -> ... -> Copy member ID. Empty means no tag.
SLACK_USER_ID = ""


def notify_slack(message):
    webhook_url = ""
    try:
        requests.post(webhook_url, json={"text": f"{SLACK_USER_ID} {message}".strip()})
    except Exception as e:
        print(f"Slack notification failed: {e}")

metadata = {
    "protocolName": "Heat ShockTransformation 96 Wells V1.3",
    "description": "A protocol to transform 96 wells of competent cells",
    "author": "JATD"
}

requirements = {
    "robotType": "Flex", # Ensure the robot type is Flex,
    "apiLevel": "2.23",
    }

def run(protocol: protocol_api.ProtocolContext):
    # load the labware
    tips1 = protocol.load_labware("opentrons_flex_96_tiprack_50ul", "A2")
    trash = protocol.load_trash_bin("A3")
    heat_mod = protocol.load_module(module_name="temperatureModuleV2", location="D1")
    tc_mod = protocol.load_module(module_name="thermocyclerModuleV2")
    cells = heat_mod.load_labware("corning_96_wellplate_360ul_flat")
    dna = tc_mod.load_labware("opentrons_96_wellplate_200ul_pcr_full_skirt")
    left_pipette = protocol.load_instrument(
        "flex_1channel_50",
        mount="left",
        tip_racks=[tips1]
    )
    tc_mod.open_lid()
    tc_mod.set_block_temperature(4)
    heat_mod.set_temperature(4)

    ################################## Transfer DNA to Cells ##################################
    # Transfer 1ul from each well of dna to corresponding well of cells
    for well in dna.wells():
        
        left_pipette.pick_up_tip()
        left_pipette.aspirate(3, well.bottom(0))
        left_pipette.dispense(3, cells[well.well_name], rate=0.5)
        left_pipette.blow_out(cells[well.well_name].bottom())
        left_pipette.mix(1, 30, cells[well.well_name].bottom())
        left_pipette.drop_tip()
    
    ##################### Incubate on Ice for 30 minutes #####################
    notify_slack("DNA transfer and mixing complete - Add lid ")
    protocol.delay(minutes=30, msg="Incubating on Ice for 30 minutes")
    protocol.comment("Please add plate lid to reduce contamination risk")
    ##################### Heat Shock at 42C for 30 seconds #####################
    heat_mod.set_temperature(42)
    protocol.delay(seconds=30, msg="Heat shocking at 42C for 30 seconds")
    notify_slack("Heat Shock complete")
    heat_mod.set_temperature(4)
    ##################### Incubate on Ice for 5 minutes #####################
    # Send notification immediately, protocol continues without waiting
    notify_slack("Heat shock complete - Incubating for 5 mins then proceed to recovery step in Hood")
    protocol.delay(minutes=5, msg="Incubating on Ice for 5 minutes")
    ##################### Transfer Cells to Recovery Media #####################
